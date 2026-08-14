// این اسکریپت را GitHub Action در هر push به Source.js اجرا می‌کند.
// کاری که می‌کند دقیقاً همان کاری‌ست که دکمه‌ی «آپدیت خودکار» داخل خود پنل انجام می‌دهد:
// bindingهای فعلیِ هر Worker را می‌خواند، همان‌ها را نگه می‌دارد، و فقط کد را با نسخه‌ی
// تازه‌ی همین ریپو جایگزین می‌کند. به این ترتیب هر تغییری که روی Source.js بدهید،
// بدون نیاز به کلیک دستی، روی ساب‌لینک(های) از قبل دیپلوی‌شده هم اعمال می‌شود.

const API_TOKEN = process.env.CF_API_TOKEN;
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const WORKER_NAMES = (process.env.CF_WORKER_NAMES || "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

if (!API_TOKEN || !ACCOUNT_ID) {
	console.error("CF_API_TOKEN یا CF_ACCOUNT_ID تنظیم نشده (به Secrets ریپو اضافه کنید).");
	process.exit(1);
}
if (WORKER_NAMES.length === 0) {
	console.error("CF_WORKER_NAMES خالی است. نام Worker(های) خود را با کاما جدا کرده و در Secret بگذارید (مثال: miladconfig-worker,miladconfig-worker2).");
	process.exit(1);
}

const fs = await import("node:fs/promises");
const sourceCode = await fs.readFile(new URL("../../Source.js", import.meta.url), "utf8");

const cfHeaders = {
	Authorization: "Bearer " + API_TOKEN,
	"User-Agent": "MiliConfig2-CI/1.0",
};

async function deployOne(scriptName) {
	console.log("--- در حال بررسی Worker: " + scriptName + " ---");

	const bindingsRes = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${scriptName}/bindings`,
		{ headers: cfHeaders }
	);
	if (!bindingsRes.ok) {
		console.warn("⚠️  " + scriptName + " پیدا نشد یا دسترسی ندارید (وضعیت " + bindingsRes.status + ")؛ رد شد.");
		return { scriptName, skipped: true };
	}
	const bindingsData = await bindingsRes.json();
	if (!bindingsData.success) {
		console.warn("⚠️  خواندن bindingهای " + scriptName + " ناموفق بود؛ رد شد.");
		return { scriptName, skipped: true };
	}

	const newBindings = [];
	for (const b of bindingsData.result || []) {
		if (b.name === "CF_API_TOKEN" || b.name === "CF_ACCOUNT_ID") continue;
		if (b.type === "d1") {
			newBindings.push({ type: "d1", name: b.name, id: b.database_id || b.id });
		} else if (b.type === "kv_namespace") {
			newBindings.push({ type: "kv_namespace", name: b.name, namespace_id: b.namespace_id || b.id });
		} else if (b.type === "plain_text") {
			newBindings.push({ type: "plain_text", name: b.name, text: b.text || "" });
		} else if (b.type !== "secret_text") {
			newBindings.push(b);
		}
	}
	newBindings.push({ type: "secret_text", name: "CF_API_TOKEN", text: API_TOKEN });
	newBindings.push({ type: "secret_text", name: "CF_ACCOUNT_ID", text: ACCOUNT_ID });

	const metadata = {
		main_module: "zeus.js",
		compatibility_date: "2026-07-10",
		compatibility_flags: ["nodejs_compat"],
		bindings: newBindings,
	};

	const formData = new FormData();
	formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
	formData.append("zeus.js", new Blob([sourceCode], { type: "application/javascript+module" }), "zeus.js");

	const deployRes = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${scriptName}`,
		{ method: "PUT", headers: cfHeaders, body: formData }
	);
	const deployData = await deployRes.json().catch(() => ({}));
	if (!deployRes.ok || !deployData.success) {
		const msg = deployData?.errors?.[0]?.message || "کد وضعیت HTTP: " + deployRes.status;
		throw new Error(scriptName + ": خطای دیپلوی: " + msg);
	}
	console.log("✅ " + scriptName + " با موفقیت به‌روزرسانی شد.");
	return { scriptName, skipped: false };
}

let hadFailure = false;
for (const name of WORKER_NAMES) {
	try {
		await deployOne(name);
	} catch (err) {
		hadFailure = true;
		console.error("❌ " + err.message);
	}
}

if (hadFailure) process.exit(1);

// Spatial Classroom - client runtime (no build step)
// Uses pdfjs-dist from CDN and Netlify Edge Function at /api/chat

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
	"https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.mjs";

const $ = (sel) => {
	const el = document.querySelector(sel);
	if (!el) {
		console.warn(`Missing required element: ${sel}`);
		return document.createElement("div");
	}
	return el;
};

const state = {
	mode: document.documentElement.classList.contains("dark") ? "dark" : "light",

	leo: {
		avatar_emotion: "thinking",
		understanding_percentage: 0,
		pose: "stand", // sit | stand | desk
	},

	teacher: {
		lastTypedAt: Date.now(),
	},

	context: {
		extractedText: "",
		lastLoadedAt: null,
		sources: [],
	},

	metrics: {
		activeStart: Date.now(),
		knowledgeGain: 0,
		patience: 80,
	},

	inFlight: {
		student: false,
		copilot: false,
	},
};

window.extractedContext = ""; // requested persistent cache

// Elements
const els = {
	themeToggleBtn: $("#themeToggleBtn"),

	teacherForm: $("#teacherForm"),
	teacherInput: $("#teacher-message-input"),
	sendTeacherBtn: $("#send-lesson-btn"),

	copilotForm: $("#copilotForm"),
	copilotInput: $("#copilotInput"),
	copilotHint: $("#copilotHint"),

	pdfFileInput: $("#pdfFileInput"),
	sourcesList: $("#sourcesList"),
	contextStatus: $("#contextStatus"),

	blackboardLog: $("#classroom-chat-scroller"),
	systemTerminal: $("#systemTerminal"),

	leoPoseRoot: $("#leo-character-sprite"),
	leoEmotionText: $("#leoEmotionText"),
	leoEmotionPill: $("#leoEmotionPill"),

	understandingBar: $("#understandingBar"),
	understandingPctText: $("#understandingPctText"),
	patienceBar: $("#patienceBar"),
	patiencePctText: $("#patiencePctText"),

	activeTimeText: $("#activeTimeText"),
	knowledgeGainText: $("#knowledgeGainText"),

	focusChip: $("#focusChip"),
	poseChip: $("#poseChip"),

	orderSitBtn: $("#orderSitBtn"),
	orderStandBtn: $("#orderStandBtn"),
	orderDeskBtn: $("#orderDeskBtn"),
};

function nowHHMMSS() {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}

function setTheme(next) {
	state.mode = next;
	if (next === "dark") document.documentElement.classList.add("dark");
	else document.documentElement.classList.remove("dark");
}

function toggleTheme() {
	const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
	setTheme(next);
	appendTerminal("MODE", `Theme set to ${next}`);
	// Must not clear buffers: we do not touch input/log state.
}

function dimSidebars(on) {
	document.body.classList.toggle("dim-sidebars", !!on);
}

function isUserActiveRecently(ms = 12_000) {
	return Date.now() - state.teacher.lastTypedAt <= ms;
}

function appendBlackboard(role, text, tone = "normal") {
	const wrap = document.createElement("div");
	const roleLabel =
		role === "leo" ? "LEO" : role === "teacher" ? "TEACHER" : role === "system" ? "SYSTEM" : "NOTE";

	const classBase =
		"rounded-lg px-3 py-2 border border-white/10 bg-white/5 dark:bg-white/[0.04]";

	const toneClass =
		tone === "highlight"
			? "text-white font-semibold"
			: tone === "warn"
				? "text-amber-200"
				: "text-slateink dark:text-white/85";

	wrap.className = `${classBase} ${toneClass}`;

	wrap.innerHTML = `
		<div class="text-[10px] uppercase tracking-widest opacity-70 mb-1">${roleLabel} • ${nowHHMMSS()}</div>
		<div class="whitespace-pre-wrap leading-5"></div>
	`;
	wrap.querySelector("div:last-child").textContent = text;

	els.blackboardLog.appendChild(wrap);
	els.blackboardLog.scrollTop = els.blackboardLog.scrollHeight;
}

function appendTerminal(tag, msg) {
	const line = document.createElement("div");
	line.className = "opacity-90";
	line.textContent = `[${nowHHMMSS()}] ${tag}: ${msg}`;
	els.systemTerminal.appendChild(line);
	els.systemTerminal.scrollTop = els.systemTerminal.scrollHeight;
}

function setUnderstanding(pct) {
	const p = clamp(Math.round(pct), 0, 100);
	state.leo.understanding_percentage = p;
	els.understandingBar.style.width = `${p}%`;
	els.understandingPctText.textContent = `${p}%`;

	// lightweight knowledge gain model
	state.metrics.knowledgeGain = clamp(state.metrics.knowledgeGain + p / 500, 0, 99);
	els.knowledgeGainText.textContent = `+${state.metrics.knowledgeGain.toFixed(1)} pts`;
}

function setPatience(pct) {
	const p = clamp(Math.round(pct), 0, 100);
	state.metrics.patience = p;
	els.patienceBar.style.width = `${p}%`;
	els.patiencePctText.textContent = `${p}%`;
}

function setLeoEmotion(emotion) {
	state.leo.avatar_emotion = emotion;
	els.leoEmotionText.textContent = emotion;

	// quick UI mapping
	const icon =
		emotion === "eureka"
			? "auto_awesome"
			: emotion === "confused"
				? "help"
				: emotion === "bored"
					? "schedule"
					: emotion === "standing_on_desk"
						? "warning"
						: "psychology";

	const iconEl = els.leoEmotionPill.querySelector ? els.leoEmotionPill.querySelector(".material-symbols-outlined") : null;
	if (iconEl) {
		iconEl.textContent = icon;
	}
}

function setLeoPose(pose) {
	// pose: sit | stand | desk
	state.leo.pose = pose;

	els.leoPoseRoot.classList.remove("leo-sit", "leo-stand", "leo-jump");
	if (pose === "sit") {
		els.leoPoseRoot.classList.add("leo-sit");
		els.poseChip.textContent = "Sitting";
	} else if (pose === "desk") {
		els.leoPoseRoot.classList.add("leo-jump");
		els.poseChip.textContent = "On desk";
	} else {
		els.leoPoseRoot.classList.add("leo-stand");
		els.poseChip.textContent = "Standing";
	}
}

function setFocusChip(text) {
	els.focusChip.textContent = text;
}

// Network
async function postChat({ pipeline, teacherInput, contextText }) {
	const res = await fetch("/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			pipeline,
			teacher_input: teacherInput ?? "",
			context: contextText ?? "",
		}),
	});

	if (!res.ok) {
		const t = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
	}

	const ct = res.headers.get("content-type") || "";
	if (ct.includes("application/json")) return await res.json();
	return await res.text();
}

// Core Socratic loop
async function runStudentTurn(teacherText) {
	if (!teacherText.trim()) return;

	if (state.inFlight.student) return;
	state.inFlight.student = true;
	els.sendTeacherBtn.disabled = true;
	els.sendTeacherBtn.style.opacity = "0.6";

	appendBlackboard("teacher", teacherText);
	scrollToClassroomBottom();

	try {
		appendTerminal("REQ", "Student pipeline");
		const payload = await postChat({
			pipeline: "student",
			teacherInput: teacherText,
			contextText: window.extractedContext || "",
		});
		scrollToClassroomBottom();

		// Validate strict JSON schema
		const emotion = payload?.avatar_emotion;
		const understanding = payload?.understanding_percentage;
		const dialogue = payload?.student_dialogue;

		if (
			typeof emotion !== "string" ||
			typeof understanding !== "number" ||
			typeof dialogue !== "string"
		) {
			throw new Error("Invalid student JSON schema returned by backend.");
		}

		setLeoEmotion(emotion);
		setUnderstanding(understanding);

		// Emotion to patience nudges
		if (emotion === "bored") setPatience(state.metrics.patience - 8);
		else if (emotion === "confused") setPatience(state.metrics.patience - 3);
		else if (emotion === "eureka") setPatience(state.metrics.patience + 4);
		else setPatience(state.metrics.patience);

		appendBlackboard("leo", dialogue, emotion === "eureka" ? "highlight" : "normal");
		appendTerminal("OK", `Student JSON (${emotion}, ${Math.round(understanding)}%)`);
	} catch (err) {
		appendTerminal("ERR", err?.message || String(err));
		appendBlackboard(
			"system",
			`Leo couldn't respond due to a system error. Try again.\n${err?.message || err}`,
			"warn",
		);
	} finally {
		state.inFlight.student = false;
		els.sendTeacherBtn.disabled = false;
		els.sendTeacherBtn.style.opacity = "1";
	}
}

async function runCopilotHint(query) {
	if (!query.trim()) return;

	if (state.inFlight.copilot) return;
	state.inFlight.copilot = true;

	try {
		appendTerminal("REQ", "Copilot pipeline");
		const text = await postChat({
			pipeline: "copilot",
			teacherInput: query,
			contextText: window.extractedContext || "",
		});
		const hint = typeof text === "string" ? text : JSON.stringify(text);

		els.copilotHint.textContent = hint;
		appendTerminal("OK", "Copilot hint updated");
	} catch (err) {
		appendTerminal("ERR", err?.message || String(err));
		els.copilotHint.textContent = "Copilot unavailable right now.";
	} finally {
		state.inFlight.copilot = false;
	}
}

// Random distraction engine (every 45s)
const distractionStatements = [
	"I’m kinda bored… is this on the test?",
	"Wait, can we do it with a spaceship example?",
	"I think I get it but also… I don’t.",
	"If I stand on the desk will it make sense faster?",
	"Can I draw it? Words are confusing.",
];

function triggerDistraction() {
	// Force chaotic pose + emotion
	const roll = Math.random();
	if (roll < 0.45) {
		setLeoEmotion("bored");
		setLeoPose("sit");
		setFocusChip("Bored");
	} else {
		setLeoEmotion("standing_on_desk");
		setLeoPose("desk");
		setFocusChip("Chaotic");
	}

	const msg = distractionStatements[Math.floor(Math.random() * distractionStatements.length)];
	appendBlackboard("leo", msg, "warn");
	appendTerminal("AI", "Distraction triggered");
}

setInterval(() => {
	const inactive = !isUserActiveRecently();
	const bored = state.leo.avatar_emotion === "bored";
	if (inactive || bored) triggerDistraction();
}, 45_000);

// Mechanical teacher orders
function applyTeacherOrder(order) {
	if (order === "sit") {
		setLeoPose("sit");
		setLeoEmotion("thinking");
		setFocusChip("Reset");
		appendTerminal("ORDER", "Sit");
	} else if (order === "stand") {
		setLeoPose("stand");
		setLeoEmotion("thinking");
		setFocusChip("Focused");
		appendTerminal("ORDER", "Stand");
	} else if (order === "desk") {
		setLeoPose("desk");
		setLeoEmotion("standing_on_desk");
		setFocusChip("Chaotic");
		appendTerminal("ORDER", "Jump on Desk");
		appendBlackboard("leo", "I’m on the desk. I can see the concepts better from up here!", "warn");
	}
}

// PDF extraction
async function extractPdfText(file) {
	appendTerminal("PDF", `Loading ${file.name} (${Math.round(file.size / 1024)} KB)`);
	const buf = await file.arrayBuffer();
	const doc = await pdfjsLib.getDocument({ data: buf }).promise;

	let all = "";
	for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
		const page = await doc.getPage(pageNum);
		const txt = await page.getTextContent();
		const strings = txt.items.map((it) => (typeof it?.str === "string" ? it.str : "")).filter(Boolean);
		all += strings.join(" ") + "\n";
	}

	// Hard cap to keep payloads sane (edge + model). Still “all raw characters” up to cap.
	const capped = all.slice(0, 120_000);
	return capped;
}

function renderSources() {
	els.sourcesList.innerHTML = "";
	if (!state.context.sources.length) {
		const li = document.createElement("li");
		li.className = "glass-button p-3 rounded-lg flex items-center gap-3";
		li.innerHTML = `<span class="material-symbols-outlined">description</span><span class="truncate">Upload a PDF to provide lesson context</span>`;
		els.sourcesList.appendChild(li);
		return;
	}

	for (const s of state.context.sources) {
		const li = document.createElement("li");
		li.className = "glass-button p-3 rounded-lg flex items-center gap-3";
		li.innerHTML = `<span class="material-symbols-outlined">description</span><span class="truncate"></span>`;
		li.querySelector("span.truncate").textContent = s.name;
		els.sourcesList.appendChild(li);
	}
}

// Focus/blur dimming
function bindDimming() {
	const focusTargets = [els.teacherInput, els.copilotInput];

	focusTargets.forEach((input) => {
		input.addEventListener("focus", () => dimSidebars(true));
		input.addEventListener("blur", () => dimSidebars(false));
		input.addEventListener("input", () => {
			state.teacher.lastTypedAt = Date.now();
			dimSidebars(true);
		});
	});

	window.addEventListener("focus", () => dimSidebars(true));
	window.addEventListener("blur", () => dimSidebars(false));

	// "Return instantly to 100% on mouse-out"
	document.addEventListener("pointerleave", () => dimSidebars(false));
	document.addEventListener("pointerenter", () => {
		// only re-dim if currently focused in inputs
		const active = document.activeElement === els.teacherInput || document.activeElement === els.copilotInput;
		dimSidebars(active);
	});
}

// Active time ticker
setInterval(() => {
	const elapsed = Math.floor((Date.now() - state.metrics.activeStart) / 1000);
	const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
	const ss = String(elapsed % 60).padStart(2, "0");
	els.activeTimeText.textContent = `${mm}:${ss}`;
}, 500);

// Event wiring
els.themeToggleBtn.addEventListener("click", toggleTheme);

els.teacherForm.addEventListener("submit", async (e) => {
	e.preventDefault();
	const text = els.teacherInput.value;
	els.teacherInput.value = "";
	state.teacher.lastTypedAt = Date.now();
	await runStudentTurn(text);
});

els.sendTeacherBtn.addEventListener("click", async (e) => {
	e.preventDefault();
	const text = els.teacherInput.value;
	if (!text) return;
	els.teacherInput.value = "";
	state.teacher.lastTypedAt = Date.now();
	await runStudentTurn(text);
});

els.teacherInput.addEventListener("keydown", async (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		const text = els.teacherInput.value;
		if (!text) return;
		els.teacherInput.value = "";
		state.teacher.lastTypedAt = Date.now();
		await runStudentTurn(text);
	}
});

els.copilotForm.addEventListener("submit", async (e) => {
	e.preventDefault();
	const q = els.copilotInput.value;
	els.copilotInput.value = "";
	state.teacher.lastTypedAt = Date.now();
	await runCopilotHint(q);
});

els.orderSitBtn.addEventListener("click", () => applyTeacherOrder("sit"));
els.orderStandBtn.addEventListener("click", () => applyTeacherOrder("stand"));
els.orderDeskBtn.addEventListener("click", () => applyTeacherOrder("desk"));

els.pdfFileInput.addEventListener("change", async (e) => {
	const file = e.target.files?.[0];
	if (!file) return;

	try {
		const text = await extractPdfText(file);
		state.context.extractedText = text;
		state.context.lastLoadedAt = Date.now();
		state.context.sources = [{ name: file.name, type: "pdf", size: file.size }];

		window.extractedContext = text;

		renderSources();
		els.contextStatus.textContent = `Context: loaded (${file.name}, ${Math.round(text.length / 1000)}k chars)`;
		appendTerminal("PDF", `Extracted ${text.length} chars`);
		appendBlackboard("system", `Loaded PDF context from "${file.name}".`, "highlight");
	} catch (err) {
		appendTerminal("ERR", `PDF parse failed: ${err?.message || err}`);
		els.contextStatus.textContent = "Context: failed to load";
		appendBlackboard("system", "Could not parse that PDF. Try another file.", "warn");
	} finally {
		els.pdfFileInput.value = "";
	}
});

// Init
function bootstrap() {
	// Dynamically inject the avatar img if not present (presents the avatar within the pristine wrapper)
	const sprite = document.getElementById("leo-character-sprite");
	if (sprite && !sprite.querySelector("img")) {
		sprite.innerHTML = `<img id="leoPortrait" class="h-full w-full object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.3)] pointer-events-none select-none" src="https://lh3.googleusercontent.com/aida/AP1WRLvQ62iwa6UZ4AIc2ZD6EmSEagPdEmRTY4E6uihRX7xm0bH6a-X2_DgDkISJlzXA6ZiHeC7ADIL5t9S4Lhz8Pix6xLsIuRNon8BAopiHNZGqyo7HD8IrXc_BohPvyncarpooj9tyYjZueFR0TSWRBg3tLZrIfJJcOajROlNpdp09_VI2tbnTdTMSP58JZir3MwCDYNj0WxCd3gAkQv9MEyhFl4zwRS6tjlndzSAkTbw1YXLHweXA6tSL19w" alt="Leo" />`;
	}

	// Initial log lines (NOT dummy “LOG 14:02” overlays; placed into blackboard + terminal cleanly)
	appendTerminal("BOOT", "Spatial Classroom ready");
	appendTerminal("EDGE", "POST /api/chat");
	appendBlackboard("system", "Connection established. Start teaching Leo below.", "highlight");

	setLeoEmotion("thinking");
	setLeoPose("stand");
	setUnderstanding(0);
	setPatience(80);
	setFocusChip("Curious");
	renderSources();
	bindDimming();
}

bootstrap();

/**
 * Classroom Auto-Scroll System Engine
 * Automatically snaps viewport display baseline down to the latest dialogue row node
 */
function scrollToClassroomBottom() {
  const chatScroller = document.getElementById("classroom-chat-scroller");
  if (chatScroller) {
    // Force immediate UI repaint baseline realignment to absolute scroll envelope height
    chatScroller.scrollTop = chatScroller.scrollHeight;
  }
}

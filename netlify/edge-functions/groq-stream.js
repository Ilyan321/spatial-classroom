// Netlify Edge Function (Deno runtime)
// Route configured in netlify.toml to /api/chat
//
// Pipelines:
// - student: strict JSON response with response_format: { type: "json_object" }
// - copilot: brief hint as plain text
//
// Env: GROQ_API_KEY

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// 🔥 FIXED: Swapped out decommissioned specdec model for the active versatile identifier
const MODEL = "llama-3.3-70b-versatile"; 

function json(resBody, status = 200, headers = {}) {
	return new Response(JSON.stringify(resBody), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...headers,
		},
	});
}

function text(resText, status = 200, headers = {}) {
	return new Response(resText, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			...headers,
		},
	});
}

function safeTrimContext(raw, maxChars = 120_000) {
	if (!raw || typeof raw !== "string") return "";
	const t = raw.trim();
	if (t.length <= maxChars) return t;
	return t.slice(0, maxChars);
}

function corsHeaders() {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "POST, OPTIONS",
		"access-control-allow-headers": "content-type",
	};
}

async function groqChat({ apiKey, messages, response_format }) {
	const body = {
		model: MODEL,
		messages,
		temperature: 0.7,
		top_p: 0.9,
	};

	if (response_format) body.response_format = response_format;

	const r = await fetch(GROQ_API_URL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!r.ok) {
		const t = await r.text().catch(() => "");
		throw new Error(`Groq HTTP ${r.status}: ${t || r.statusText}`);
	}

	const data = await r.json();
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content !== "string" || !content.trim()) {
		throw new Error("Groq returned empty content.");
	}
	return content;
}

export default async (request) => {
	// CORS preflight
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders() });
	}

	if (request.method !== "POST") {
		return text("Method Not Allowed", 405, corsHeaders());
	}

	const apiKey = Deno.env.get("GROQ_API_KEY");
	if (!apiKey) {
		return text("Server misconfigured: missing GROQ_API_KEY", 500, corsHeaders());
	}

	let payload;
	try {
		payload = await request.json();
	} catch {
		return text("Invalid JSON body", 400, corsHeaders());
	}

	const pipeline = payload?.pipeline;
	const teacherInput = typeof payload?.teacher_input === "string" ? payload.teacher_input : "";
	const contextRaw = typeof payload?.context === "string" ? payload.context : "";
	const context = safeTrimContext(contextRaw);

	if (pipeline !== "student" && pipeline !== "copilot") {
		return text("Invalid pipeline. Use 'student' or 'copilot'.", 400, corsHeaders());
	}

	try {
		if (pipeline === "student") {
			// Student pipeline: strict JSON object matching exact keys.
			const system = `
You are Leo, a 12-year-old student. You are curious, easily confused, and take things literally.
You MUST return a single JSON object with EXACTLY these keys:
- "avatar_emotion": one of "confused" | "thinking" | "eureka" | "bored" | "standing_on_desk"
- "understanding_percentage": integer 0..100
- "student_dialogue": a single natural sentence Leo says (no extra metadata)

Rules:
- Output MUST be valid JSON.
- Do NOT wrap in markdown.
- No extra keys.
- Keep dialogue short, vivid, and realistically "12-year-old".
- Use the provided context to ground what you say, but do not quote long passages.
`;

			const user = `
TEACHER INPUT:
${teacherInput.trim() || "(no teacher input provided)"}

CONTEXT (student background material):
${context || "(no context provided)"}
`.trim();

			const content = await groqChat({
				apiKey,
				messages: [
					{ role: "system", content: system.trim() },
					{ role: "user", content: user },
				],
				response_format: { type: "json_object" },
			});

			// Ensure we return JSON to client (parse + reserialize to enforce)
			let obj;
			try {
				obj = JSON.parse(content);
			} catch {
				throw new Error("Model did not return valid JSON.");
			}

			// Minimal schema enforcement (fail closed)
			const okEmotion =
				obj?.avatar_emotion === "confused" ||
				obj?.avatar_emotion === "thinking" ||
				obj?.avatar_emotion === "eureka" ||
				obj?.avatar_emotion === "bored" ||
				obj?.avatar_emotion === "standing_on_desk";

			const okUnderstanding =
				Number.isFinite(obj?.understanding_percentage) &&
				Math.floor(obj.understanding_percentage) === obj.understanding_percentage &&
				obj.understanding_percentage >= 0 &&
				obj.understanding_percentage <= 100;

			const okDialogue = typeof obj?.student_dialogue === "string" && obj.student_dialogue.trim().length > 0;

			if (!okEmotion || !okUnderstanding || !okDialogue) {
				throw new Error("Model JSON did not match required schema.");
			}

			const normalized = {
				avatar_emotion: obj.avatar_emotion,
				understanding_percentage: obj.understanding_percentage,
				student_dialogue: obj.student_dialogue,
			};

			return json(normalized, 200, corsHeaders());
		}

		// Copilot pipeline: brief, high-impact hint as plain text
		const system = `
You are a stealthy Teacher Co-Pilot.
Goal: help the teacher explain complex ideas simply.
Return ONLY a brief 1-2 sentence hint or real-world analogy.
Do NOT output JSON. Do NOT include bullet points. Do NOT include extra commentary.
`.trim();

		const user = `
Teacher request:
${teacherInput.trim() || "(no teacher input provided)"}

Optional context:
${context || "(no context provided)"}
`.trim();

		const hint = await groqChat({
			apiKey,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
		});

		// Force to plain text (strip accidental code fences)
		const cleaned = hint.replace(/^```[\s\S]*?\n/, "").replace(/```$/m, "").trim();
		return text(cleaned, 200, corsHeaders());
	} catch (err) {
		return text(`Upstream error: ${err?.message || err}`, 502, corsHeaders());
	}
};


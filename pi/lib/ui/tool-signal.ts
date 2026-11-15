import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { compactPath } from "./tool-paths.ts";

export type Tone = "dim" | "text";
export type Paint = (tone: Tone, text: string) => string;
export const unstyled: Paint = (_tone, text) => text;
export const cleanSummary = (text: string): string => stripTerminalSequences(text)
	.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();

/** Style only the final path segment; alias marking is reserved for an inserted ~. */
export function pathSignal(path: string, home: string, width: number, markHome: (text: string) => string, paint: Paint): string {
	const shown = compactPath(path, home, width);
	const slash = shown.lastIndexOf("/") + 1;
	const root = home.replace(/\/+$/, "");
	const aliased = !!root && (path === root || path.startsWith(root + "/")) && shown.startsWith("~");
	const start = aliased ? 1 : 0;
	return (aliased ? markHome("~") : "") + paint("dim", shown.slice(start, Math.max(start, slash)))
		+ paint("text", shown.slice(Math.max(start, slash)));
}

const wrappers = new Set(["sudo", "env", "time", "exec", "nohup", "xargs"]);
const keywords = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "select", "!"]);

/**
 * Presentation lexer, not a shell parser. Only simple literal pipelines/lists
 * are styled. Expansions, redirections, comments, escapes, compound syntax,
 * incomplete quotes and wrapper options fall back rather than guessing.
 * Nothing here is used to execute or assess the safety of a command.
 */
export function commandSignal(command: string, home: string, markHome: (text: string) => string, paint: Paint): string {
	command = stripTerminalSequences(command).trim();
	const fallback = () => paint("dim", cleanSummary(command));
	if (/[\n\r$`\\#<>(){}]/.test(command)) return fallback();
	const tokens = command.match(/\s+|&&|\|\||[|;]|(?:[^\s'"|;&]+|'[^']*'|"[^"]*")+|./g) ?? [];
	if (tokens.some(token => token === "&" || token === "'" || token === '"' || keywords.has(token))) return fallback();
	let expectProgram = true;
	const out: string[] = [];
	for (const token of tokens) {
		if (/^\s+$/.test(token)) { out.push(paint("dim", " ")); continue; }
		if (/^(?:&&|\|\||[|;])$/.test(token)) {
			expectProgram = true;
			out.push(paint("dim", token));
			continue;
		}
		const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
		const wrapper = wrappers.has(token);
		if (expectProgram && token.startsWith("-")) return fallback();
		const program = expectProgram && !assignment && !wrapper;
		if (program) expectProgram = false;
		// Only shorten an entire literal path word, never a URL, flag or substring.
		const quote = token[0] === '"' || token[0] === "'" ? token[0] : "";
		const literal = quote && token.endsWith(quote) ? token.slice(1, -1) : token;
		const simple = !/['"]/.test(literal);
		if (simple && literal.startsWith("/")) {
			const shown = compactPath(cleanSummary(literal), home, Infinity);
			const tone = program ? "text" : "dim";
			out.push(shown.startsWith("~")
				? paint(tone, quote) + markHome("~") + paint(tone, shown.slice(1) + quote)
				: paint(tone, quote + shown + quote));
		} else out.push(paint(program ? "text" : "dim", cleanSummary(token)));
	}
	return out.join("").trim();
}

/** Text-only diagnostic; prefer explicit errors over progress logs and stack frames. */
export function failureSummary(result: { content?: { type: string; text?: string }[] }): string {
	const lines = (result.content ?? []).filter(part => part.type === "text" && typeof part.text === "string")
		.flatMap(part => stripTerminalSequences(part.text!).split(/\r?\n/))
		.map(line => line.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trimEnd())
		.filter(line => line.trim());
	const diagnostic = lines.find(line => /\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT)\b|(?:^|\s)(?:\w*Error:|error:|fatal:)|permission denied|not found|no such file|timed out|aborted|could not find/i.test(line))
		?? lines.filter(line => !/^\s*at\s/.test(line)).at(-1);
	return diagnostic ? cleanSummary(diagnostic) : "failed (no text output)";
}

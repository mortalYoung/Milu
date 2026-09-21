import { File, FileArchive, FileAudio, FileCode, FileCog, FileDiff, FileImage, FileJson, FileSymlink, FileTerminal, FileText, FileVideo } from "lucide-react";

export function fileGlyph(name: string, className: string) {
	const base = name.toLowerCase();
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot + 1) : "";
	switch (ext) {
		case "ts":
		case "mts":
		case "cts":
		case "tsx":
		case "js":
		case "mjs":
		case "cjs":
		case "jsx":
		case "py":
		case "pyw":
		case "html":
		case "htm":
		case "css":
		case "sql":
			return <FileCode size={14} className={className} />;
		case "json":
		case "jsonc":
			return <FileJson size={14} className={className} />;
		case "md":
		case "mdx":
		case "markdown":
		case "txt":
			return <FileText size={14} className={className} />;
		case "yml":
		case "yaml":
		case "toml":
		case "ini":
		case "cfg":
		case "env":
			return <FileCog size={14} className={className} />;
		case "sh":
		case "bash":
		case "zsh":
			return <FileTerminal size={14} className={className} />;
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "webp":
		case "svg":
		case "ico":
		case "avif":
			return <FileImage size={14} className={className} />;
		case "diff":
		case "patch":
			return <FileDiff size={14} className={className} />;
		case "zip":
		case "gz":
		case "tar":
		case "rar":
		case "7z":
			return <FileArchive size={14} className={className} />;
		case "mp3":
		case "wav":
		case "ogg":
		case "m4a":
			return <FileAudio size={14} className={className} />;
		case "mp4":
		case "mov":
		case "mkv":
		case "webm":
			return <FileVideo size={14} className={className} />;
		default:
			return <File size={14} className={className} />;
	}
}

export function linkGlyph(className: string) {
	return <FileSymlink size={14} className={className} />;
}

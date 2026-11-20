import { readFileSync } from "node:fs";
import { join } from "node:path";

/* New API limits each market guide and changelog to 256 KiB */
const MAX_DOCUMENT_BYTES = 256 * 1024;

/**
 * Read a market document and the translations it declares
 * @param {string} directory Plugin source directory
 * @param {"README" | "CHANGELOG"} type Document base name
 * @param {object} meta Compiled plugin manifest
 * @returns {{ files: Map<string, Buffer>, translations: Record<string, string> }} Release assets
 */
export function releaseDocuments(directory, type, meta) {
    const baseName = `${type}.md`;
    const { bytes, header } = readDocument(directory, baseName, type, meta, "en");
    const files = new Map([[baseName, bytes]]);
    const translations = header.translations ?? {};
    if (typeof translations !== "object" || Array.isArray(translations) || Object.keys(translations).length > 10) {
        throw new Error(`${baseName} translations must be an object with up to ten entries`);
    }
    for (const [locale, file] of Object.entries(translations)) {
        if (locale === "en" || Intl.getCanonicalLocales(locale)[0] !== locale || file !== `${type}.${locale}.md`) {
            throw new Error(`${baseName} has an invalid translation for ${locale}`);
        }
        const translation = readDocument(directory, file, type, meta, locale);
        if (translation.header.translations !== undefined) {
            throw new Error(`${file} cannot declare its own translations`);
        }
        files.set(file, translation.bytes);
    }
    return { files, translations };
}

/**
 * Validate release document metadata while preserving bytes for hashing
 * @param {string} directory Plugin source directory
 * @param {string} file Document name
 * @param {"README" | "CHANGELOG"} type Document type
 * @param {object} meta Compiled plugin manifest
 * @param {string} locale Expected locale
 * @returns {{ bytes: Buffer, header: object }} Original bytes and parsed front matter
 */
function readDocument(directory, file, type, meta, locale) {
    const bytes = readFileSync(join(directory, file));
    if (bytes.length > MAX_DOCUMENT_BYTES || bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
        throw new Error(`${file} must be at most 256 KiB and have no byte order mark`);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    const header = frontMatter ? Bun.YAML.parse(frontMatter[1]) : {};
    const body = text.slice(frontMatter?.[0].length ?? 0).trimStart();
    if (!header || typeof header !== "object" || Array.isArray(header)) {
        throw new Error(`${file} front matter must be an object`);
    }
    const keys = type === "CHANGELOG"
        ? ["changelogVersion", "plugin", "version", "locale", "translations"]
        : ["locale", "translations"];
    if (Object.keys(header).some((key) => !keys.includes(key)) || (header.locale != null && header.locale !== locale)) {
        throw new Error(`${file} contains invalid front matter`);
    }
    if (type === "CHANGELOG") {
        const heading = body.split(/\r?\n/).filter((line) => line.trim()).slice(0, 2);
        if (header.changelogVersion !== 1 || header.plugin !== meta.key || header.version !== meta.version
            || header.locale !== locale || heading[0] !== "# Changelog" || heading[1] !== `## [${meta.version}]`) {
            throw new Error(`${file} must describe ${meta.key}@${meta.version} in locale ${locale}`);
        }
    } else if (!/^# \S/.test(body)) {
        throw new Error(`${file} must start with a level-one heading`);
    }
    return { bytes, header };
}

import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { releaseDocuments } from "./release-documents.js";

/* Marketplace keys use an author prefix and fit New API's 30-character limit */
const PLUGIN_KEY = /^(?=.{1,30}$)[a-z0-9][a-z0-9-]*_[a-z0-9_-]+$/;

/* The release path contains one SemVer component with no path separators */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/* The source size limit in the New API rc.51 marketplace client */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Compile one plugin and publish its immutable version into the local catalog
 * @param {string} key Plugin key and source directory name
 * @returns {Promise<void>} Completes when the release and index are on disk
 */
async function release(key) {
    if (!PLUGIN_KEY.test(key)) {
        throw new Error("Usage: bun run release <github-login_plugin-name>");
    }
    const root = resolve(import.meta.dir, "..");
    const directory = join(root, "plugins", "tasks", key);
    const indexPath = join(root, "index.json");
    const lock = join(root, ".release-lock");
    const packageInfo = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    mkdirSync(lock);
    try {
        const index = readIndex(indexPath);
        const build = Bun.spawnSync([process.execPath, "run", "build"], {
            cwd: directory,
            stdout: "inherit",
            stderr: "inherit",
        });
        if (build.exitCode !== 0) {
            throw new Error(`Build failed for ${key}`);
        }
        const artifact = join(directory, "dist", "plugin.js");
        const bytes = readFileSync(artifact);
        if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
            throw new Error("dist/plugin.js must contain between 1 byte and 8 MiB");
        }
        const plugin = await import(pathToFileURL(artifact).href);
        const { meta } = plugin;
        if (meta?.key !== key || meta.apiVersion !== 1 || typeof meta.version !== "string"
            || !SEMVER.test(meta.version) || meta.version !== packageInfo.version) {
            throw new Error("Compiled metadata must match the directory key, package version and plugin API v1");
        }

        const guide = releaseDocuments(directory, "README", meta);
        const changelog = releaseDocuments(directory, "CHANGELOG", meta);
        const files = new Map([["plugin.js", bytes], ...guide.files, ...changelog.files]);
        const prefix = `plugins/tasks/${key}/${meta.version}`;
        const records = Object.fromEntries(Array.from(files, ([name, file]) => [
            name, { path: `${prefix}/${name}`, sha256: createHash("sha256").update(file).digest("hex") },
        ]));
        const version = {
            version: meta.version,
            ...records["plugin.js"],
            minApiVersion: meta.apiVersion,
            kind: "task",
            ...(meta.baseUrl && { baseUrl: meta.baseUrl }),
            ...(meta.auth && { auth: typeof meta.auth === "string" ? meta.auth : meta.auth.type }),
            ...(meta.allowedHosts?.length && { allowedHosts: meta.allowedHosts }),
            readme: documentRecord(records, "README.md", guide.translations),
            changelog: documentRecord(records, "CHANGELOG.md", changelog.translations),
        };
        const next = updateIndex(index, plugin, version);
        writeVersion(lock, join(directory, meta.version), files);
        const serialized = `${JSON.stringify(next, null, 4)}\n`;
        if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== serialized) {
            const draft = join(lock, "index.json");
            writeFileSync(draft, serialized);
            // Publish the index after the version directory is in place
            renameSync(draft, indexPath);
        }
        console.log(`Released ${key}@${meta.version} to ${version.path}`);
    } finally {
        rmSync(lock, { recursive: true, force: true });
    }
}

/**
 * Read the existing market index or initialize an empty v1 catalog
 * @param {string} path Repository index path
 * @returns {object} Catalog with all previously published plugins
 */
function readIndex(path) {
    if (!existsSync(path)) {
        return { indexVersion: 1, name: "zreo0 New API Plugins", plugins: [] };
    }
    const index = JSON.parse(readFileSync(path, "utf8"));
    if (index?.indexVersion !== 1 || !Array.isArray(index.plugins)) {
        throw new Error("index.json must contain a New API marketplace v1 catalog");
    }
    return index;
}

/**
 * Collect a guide or changelog and its translation hashes for the index
 * @param {object} records Version asset records keyed by filename
 * @param {string} name Default English filename
 * @param {object} translations Locale-to-filename map
 * @returns {object} Marketplace document descriptor
 */
function documentRecord(records, name, translations) {
    const entries = Object.entries(translations);
    return {
        ...records[name],
        ...(entries.length && {
            translations: Object.fromEntries(entries.map(([locale, file]) => [locale, records[file]])),
        }),
    };
}

/**
 * Merge a release while keeping all earlier versions and other plugins
 * @param {object} index Existing v1 market index
 * @param {object} plugin Compiled plugin exports and manifest
 * @param {object} version Prepared immutable version record
 * @returns {object} Updated v1 market index
 */
function updateIndex(index, plugin, version) {
    const { meta } = plugin;
    const current = index.plugins.find(({ key }) => key === meta.key);
    const versions = [...(current?.versions ?? [])];
    const existing = versions.find((entry) => entry.version === version.version);
    if (existing && !isDeepStrictEqual(existing, version)) {
        throw new Error(`${meta.key}@${meta.version} is immutable. Bump the version before publishing changed files`);
    }
    if (!existing) {
        versions.push(version);
    }
    versions.sort((left, right) => Bun.semver.order(right.version, left.version));
    const latest = versions[0].version;
    const entry = latest === meta.version
        ? { ...marketplacePlugin(plugin), latest, versions }
        : { ...current, latest, versions };
    const plugins = [...index.plugins.filter(({ key }) => key !== meta.key), entry];
    plugins.sort((left, right) => left.key < right.key ? -1 : left.key === right.key ? 0 : 1);
    return { ...index, plugins };
}

/**
 * Convert compiled plugin metadata into the catalog list fields
 * @param {object} plugin Compiled plugin exports and manifest
 * @returns {object} Marketplace entry metadata
 */
function marketplacePlugin(plugin) {
    const { meta } = plugin;
    return {
        key: meta.key,
        name: (typeof meta.name === "string" ? meta.name : meta.name?.en) || meta.key,
        author: {
            login: meta.author.name,
            ...(meta.author?.url && { url: meta.author.url }),
        },
        ...(meta.description && { description: meta.description }),
        ...(meta.icon && { icon: meta.icon }),
        ...(meta.website && { website: meta.website }),
        ...(meta.sortPriority && { sortPriority: meta.sortPriority }),
        ...(meta.models?.length && { models: meta.models }),
        ...(meta.channelTypes?.length && { channelTypes: meta.channelTypes }),
        ...(meta.routes?.length && { routes: meta.routes }),
        ...(meta.protocols?.length && { protocols: meta.protocols }),
        task: typeof plugin.buildSubmitRequest === "function",
        provider: Boolean(meta.relay?.length),
        transform: ["ingress", "request", "outbound", "egress", "reply", "report"]
            .some((hook) => typeof plugin[hook] === "function"),
    };
}

/**
 * Install a staged version directory or verify an identical earlier release
 * @param {string} lock Repository release lock and staging directory
 * @param {string} destination Version directory beside the plugin source
 * @param {Map<string, Buffer>} files Release assets and bytes
 * @returns {void}
 */
function writeVersion(lock, destination, files) {
    if (existsSync(destination)) {
        const names = readdirSync(destination);
        if (names.length !== files.size || [...files].some(([name, bytes]) => (
            !names.includes(name) || !readFileSync(join(destination, name)).equals(bytes)
        ))) {
            throw new Error(`Version directory already contains different files: ${destination}`);
        }
        return;
    }
    const draft = join(lock, "version");
    mkdirSync(draft);
    for (const [name, bytes] of files) {
        writeFileSync(join(draft, name), bytes);
    }
    renameSync(draft, destination);
}

try {
    await release(process.argv[2]);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

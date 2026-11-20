import assert from "node:assert/strict";
import { test } from "bun:test";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/* Use the production scripts in a disposable repository for each case */
const scripts = resolve(import.meta.dir, "../scripts");

/**
 * Prepare an empty test repository with the real release scripts
 * @returns {string} Path to the disposable market root
 */
function fixture() {
    const root = mkdtempSync(join(tmpdir(), "new-api-release-"));
    mkdirSync(join(root, "scripts"));
    for (const name of ["release.js", "release-documents.js"]) {
        copyFileSync(join(scripts, name), join(root, "scripts", name));
    }
    return root;
}

/**
 * Write a tiny buildable plugin and matching docs at a selected version
 * @param {string} root Disposable repository root
 * @param {string} key Plugin key
 * @param {string} version Plugin version
 * @returns {string} Plugin source directory
 */
function writePlugin(root, key, version) {
    const directory = join(root, "plugins", "tasks", key);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({
        version,
        type: "module",
        scripts: { build: "bun build ./source.js --format esm --outdir ./dist --entry-naming plugin.js" },
    }));
    const meta = { apiVersion: 1, key, version, name: "Fixture", author: { name: "sample" }, models: ["sample-model"] };
    writeFileSync(join(directory, "source.js"), `export const meta = ${JSON.stringify(meta)};\nexport function buildSubmitRequest() {}\n`);
    writeFileSync(join(directory, "README.md"), "---\ntranslations:\n  zh-CN: README.zh-CN.md\n---\n# Fixture\n");
    writeFileSync(join(directory, "README.zh-CN.md"), "---\nlocale: zh-CN\n---\n# 样例\n");
    writeFileSync(join(directory, "CHANGELOG.md"), `---\nchangelogVersion: 1\nplugin: ${key}\nversion: "${version}"\nlocale: en\n---\n# Changelog\n\n## [${version}]\n\n### Added\n\n- Add the test plugin.\n`);
    return directory;
}

/**
 * Run the release command for a fixture plugin
 * @param {string} root Disposable repository root
 * @param {string} key Plugin key
 * @returns {object} Process status and captured output
 */
function publish(root, key) {
    return Bun.spawnSync([process.execPath, join(root, "scripts", "release.js"), key], { cwd: root });
}

test("publishes verifiable files and preserves previous versions and other plugins", () => {
    const root = fixture();
    try {
        const key = "example_decisions";
        const first = writePlugin(root, key, "1.0.0");
        assert.equal(publish(root, key).exitCode, 0);
        const original = readFileSync(join(root, "index.json"));
        assert.equal(publish(root, key).exitCode, 0);
        assert.deepEqual(readFileSync(join(root, "index.json")), original);
        writePlugin(root, key, "1.1.0");
        assert.equal(publish(root, key).exitCode, 0);
        writePlugin(root, "sample_other", "2.0.0");
        assert.equal(publish(root, "sample_other").exitCode, 0);

        const { indexVersion, plugins } = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
        assert.equal(indexVersion, 1);
        assert.deepEqual(plugins.map((plugin) => plugin.key), [key, "sample_other"]);
        assert.equal(plugins[0].author.login, "sample");
        assert.equal(plugins[0].latest, "1.1.0");
        assert.deepEqual(plugins[0].versions.map(({ version }) => version), ["1.1.0", "1.0.0"]);
        const initialRelease = plugins[0].versions[1];
        for (const file of [initialRelease, initialRelease.readme, initialRelease.readme.translations["zh-CN"], initialRelease.changelog]) {
            const hash = createHash("sha256").update(readFileSync(join(root, file.path))).digest("hex");
            assert.equal(hash, file.sha256);
        }
        assert.ok(existsSync(join(first, "1.0.0", "plugin.js")));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("rejects modified files for an existing version and releases the lock", () => {
    const root = fixture();
    try {
        const directory = writePlugin(root, "sample_decisions", "1.0.0");
        assert.equal(publish(root, "sample_decisions").exitCode, 0);
        const index = readFileSync(join(root, "index.json"));
        writeFileSync(join(directory, "README.zh-CN.md"), "# 新的说明\n");
        const result = publish(root, "sample_decisions");
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr.toString(), /immutable/);
        assert.deepEqual(readFileSync(join(root, "index.json")), index);
        assert.match(readFileSync(join(directory, "1.0.0", "README.zh-CN.md"), "utf8"), /# 样例/);
        assert.equal(existsSync(join(root, ".release-lock")), false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("does not publish a version with mismatched release notes", () => {
    const root = fixture();
    try {
        const directory = writePlugin(root, "sample_decisions", "1.0.0");
        const notes = join(directory, "CHANGELOG.md");
        writeFileSync(notes, readFileSync(notes, "utf8").replace('version: "1.0.0"', 'version: "2.0.0"'));
        const result = publish(root, "sample_decisions");
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr.toString(), /must describe sample_decisions@1.0.0/);
        assert.equal(existsSync(join(root, "index.json")), false);
        assert.equal(existsSync(join(directory, "1.0.0")), false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

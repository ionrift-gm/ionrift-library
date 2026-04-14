/**
 * PackManifestSchema
 * Validation and utility functions for Ionrift content pack manifests.
 */
export class PackManifestSchema {
  /** @type {string[]} */
  static PACK_TYPES = ["art", "sfx", "data", "mixed"];

  /** @type {string[]} */
  static FORMATS = ["zip", "json"];

  /**
   * Validate a pack manifest object.
   * @param {unknown} manifest
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validate(manifest) {
    /** @type {string[]} */
    const errors = [];

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { valid: false, errors: ["Manifest must be an object."] };
    }

    const data = /** @type {Record<string, unknown>} */ (manifest);

    if (typeof data.packId !== "string" || !data.packId.trim()) {
      errors.push("packId is required and must be a non-empty string.");
    }

    if (typeof data.version !== "string" || !data.version.trim()) {
      errors.push("version is required and must be a non-empty semver string.");
    } else if (!this.#isSemver(data.version)) {
      errors.push("version must be a valid semver string.");
    }

    if (typeof data.tier !== "string" || !data.tier.trim()) {
      errors.push("tier is required and must be a non-empty string.");
    }

    if (typeof data.packType !== "string" || !this.PACK_TYPES.includes(data.packType)) {
      errors.push(`packType must be one of: ${this.PACK_TYPES.join(", ")}.`);
    }

    if (typeof data.format !== "string" || !this.FORMATS.includes(data.format)) {
      errors.push(`format must be one of: ${this.FORMATS.join(", ")}.`);
    }

    if (data.minModuleVersion !== undefined) {
      if (typeof data.minModuleVersion !== "string" || !data.minModuleVersion.trim()) {
        errors.push("minModuleVersion must be a non-empty semver string when provided.");
      } else if (!this.#isSemver(data.minModuleVersion)) {
        errors.push("minModuleVersion must be a valid semver string.");
      }
    }

    if (data.contentTypes !== undefined) {
      if (!Array.isArray(data.contentTypes) || !data.contentTypes.every((entry) => typeof entry === "string")) {
        errors.push("contentTypes must be an array of strings when provided.");
      }
    }

    if (data.files !== undefined) {
      if (!Array.isArray(data.files)) {
        errors.push("files must be an array when provided.");
      } else {
        data.files.forEach((file, index) => {
          if (!file || typeof file !== "object" || Array.isArray(file)) {
            errors.push(`files[${index}] must be an object with path and sha256.`);
            return;
          }

          const fileRecord = /** @type {Record<string, unknown>} */ (file);
          if (typeof fileRecord.path !== "string" || !fileRecord.path.trim()) {
            errors.push(`files[${index}].path must be a non-empty string.`);
          }
          if (typeof fileRecord.sha256 !== "string" || !fileRecord.sha256.trim()) {
            errors.push(`files[${index}].sha256 must be a non-empty string.`);
          }
        });
      }
    }

    // For zip packs, files are strongly recommended but not required for backward compatibility.
    if (data.format === "zip" && data.files === undefined) {
      // Intentionally no validation error.
    }

    // For json packs, files are optional by design.
    return { valid: errors.length === 0, errors };
  }

  /**
   * Compare two semver strings.
   * Returns -1 if a < b, 0 if equal, 1 if a > b.
   * Invalid semver values sort lower than valid values.
   * @param {string} a
   * @param {string} b
   * @returns {-1 | 0 | 1}
   */
  static compareVersions(a, b) {
    const left = this.#parseSemver(a);
    const right = this.#parseSemver(b);

    if (!left && !right) return 0;
    if (!left) return -1;
    if (!right) return 1;

    if (left.major !== right.major) return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;

    if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
    if (left.prerelease.length === 0) return 1;
    if (right.prerelease.length === 0) return -1;

    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = left.prerelease[index];
      const rightPart = right.prerelease[index];

      if (leftPart === undefined) return -1;
      if (rightPart === undefined) return 1;

      const leftNumeric = /^\d+$/.test(leftPart);
      const rightNumeric = /^\d+$/.test(rightPart);

      if (leftNumeric && rightNumeric) {
        const leftNumber = Number(leftPart);
        const rightNumber = Number(rightPart);
        if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
        continue;
      }

      if (leftNumeric && !rightNumeric) return -1;
      if (!leftNumeric && rightNumeric) return 1;

      if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
    }

    return 0;
  }

  /**
   * Extract and validate the `_manifest` block from a JSON pack payload.
   * @param {unknown} jsonData
   * @returns {{ valid: boolean, manifest: Record<string, unknown> | null, errors: string[] }}
   */
  static extractFromJson(jsonData) {
    /** @type {string[]} */
    const errors = [];
    let root = jsonData;

    if (typeof root === "string") {
      try {
        root = JSON.parse(root);
      } catch (_error) {
        return { valid: false, manifest: null, errors: ["jsonData is not valid JSON."] };
      }
    }

    if (!root || typeof root !== "object" || Array.isArray(root)) {
      return { valid: false, manifest: null, errors: ["jsonData must be an object or JSON object string."] };
    }

    const record = /** @type {Record<string, unknown>} */ (root);
    const manifest = record._manifest;

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      errors.push("Missing or invalid _manifest object.");
      return { valid: false, manifest: null, errors };
    }

    const validation = this.validate(manifest);
    if (!validation.valid) {
      return { valid: false, manifest: /** @type {Record<string, unknown>} */ (manifest), errors: validation.errors };
    }

    return { valid: true, manifest: /** @type {Record<string, unknown>} */ (manifest), errors: [] };
  }

  /**
   * @param {string} value
   * @returns {boolean}
   */
  static #isSemver(value) {
    return this.#parseSemver(value) !== null;
  }

  /**
   * @param {string} value
   * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
   */
  static #parseSemver(value) {
    if (typeof value !== "string") return null;

    const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
    const match = value.trim().match(semverRegex);
    if (!match) return null;

    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      prerelease: match[4] ? match[4].split(".") : []
    };
  }
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
}

export function validateManifest(manifest: any): ManifestValidation {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest is not an object'] };
  }

  if (!Array.isArray(manifest.files)) {
    errors.push('Missing "files" array');
  } else {
    for (let i = 0; i < manifest.files.length; i++) {
      const file = manifest.files[i];
      if (typeof file?.path !== 'string') {
        errors.push(`files[${i}]: missing or non-string "path"`);
      }
      if (!file?.hashes || typeof file.hashes !== 'object' || Object.keys(file.hashes).length === 0) {
        errors.push(`files[${i}]: "hashes" must be a non-empty object`);
      }
      if (file?.downloads !== undefined) {
        if (!Array.isArray(file.downloads)) {
          errors.push(`files[${i}]: "downloads" must be an array if present`);
        } else {
          for (let j = 0; j < file.downloads.length; j++) {
            if (typeof file.downloads[j] !== 'string') {
              errors.push(`files[${i}].downloads[${j}]: must be a string`);
            }
          }
        }
      }
    }
  }

  if (manifest.versionId !== undefined) {
    const parsed = Number(manifest.versionId);
    if (isNaN(parsed)) {
      errors.push('"versionId" must be a number or parseable as a number');
    }
  }

  return { valid: errors.length === 0, errors };
}

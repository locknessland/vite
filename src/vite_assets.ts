/**
 * @fileoverview `viteAssets()` — the primary user-facing helper. In dev it points
 * asset tags at the Vite dev server; in production it resolves hashed URLs from
 * the build manifest (via {@link ManifestReader}). The `nonce` option is
 * attribute-encoded onto every emitted tag — `<script>` and `<link>` alike
 * (CSP support, #114).
 *
 * @module @lockness/vite/vite_assets
 */

import { defineViteConfig } from './define_config.ts'
import { ManifestReader } from './manifest_reader.ts'
import type { LocknessViteConfig } from './shared.ts'

/** A single emitted tag, structured. */
export interface ViteAssetTag {
    /** The tag name. */
    tag: 'script' | 'link'
    /** Its attributes (already the resolved values). */
    attributes: Record<string, string>
}

/** The result of {@link viteAssets}: rendered HTML plus the structured tags. */
export interface ViteAssetsTagResult {
    /** The tags rendered to an HTML string, attribute-encoded. */
    html: string
    /** The structured tags, for callers that render their own HTML. */
    tags: ViteAssetTag[]
}

/** Options for {@link viteAssets}. */
export interface ViteAssetsOptions {
    /** Override the dev server URL (defaults to config `devServerUrl`). */
    devServerUrl?: string
    /** CSP nonce, applied to every emitted `<script>` and `<link>` tag. */
    nonce?: string
    /** Partial config; merged over DEFAULTS. */
    config?: Partial<LocknessViteConfig>
    /** Whether the caller runs under the Vite dev server (mode detection). */
    isDevServer?: boolean
    /** Inject a reader (testing seam); defaults to one built from `config`. */
    reader?: ManifestReader
}

/**
 * HTML-attribute-encode a value (S-F4) — every interpolated attribute value goes
 * through this, so a stray quote or bracket cannot break out of its attribute.
 *
 * @param value - The raw attribute value.
 * @returns The encoded value.
 */
export function encodeAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

/** Render one structured tag to an HTML string with encoded attributes. */
function renderTag(tag: ViteAssetTag): string {
    const attrs = Object.entries(tag.attributes)
        .map(([k, v]) => `${k}="${encodeAttribute(v)}"`)
        .join(' ')
    return tag.tag === 'link' ? `<link ${attrs}>` : `<script ${attrs}></script>`
}

/** Build the final result from structured tags. */
function toResult(tags: ViteAssetTag[]): ViteAssetsTagResult {
    return { tags, html: tags.map(renderTag).join('\n') }
}

/**
 * Resolve the `<script>`/`<link>` tags for an entry.
 *
 * In dev, tags point at the Vite dev server (`devServerUrl`). In production, the
 * entry is a **keyed lookup** into the manifest (never a path built from the
 * argument — S-F3); its hashed JS and every CSS dependency are emitted. A missing
 * manifest in production throws a clear error (via {@link ManifestReader}).
 *
 * @param entry - The entry key / source path (e.g. `app/client.ts`).
 * @param options - Dev URL, nonce, config, and testing seams.
 * @returns The rendered HTML and the structured tags.
 * @throws {Error} In production when the manifest is missing/malformed or the
 *   entry key is absent.
 *
 * @example
 * ```typescript
 * const { html } = await viteAssets('app/client.ts', { nonce })
 * ```
 */
export async function viteAssets(
    entry: string,
    options: ViteAssetsOptions = {},
): Promise<ViteAssetsTagResult> {
    const config = defineViteConfig(options.config)
    const reader = options.reader ??
        new ManifestReader(config, { isDevServer: options.isDevServer })
    const nonce = options.nonce
    const nonceAttr: Record<string, string> = nonce ? { nonce } : {}
    const scriptAttrs = (src: string): Record<string, string> => ({
        type: 'module',
        src,
        ...nonceAttr,
    })

    if ((await reader.mode()) === 'dev') {
        const base = (options.devServerUrl ?? config.devServerUrl).replace(
            /\/$/,
            '',
        )
        return toResult([
            { tag: 'script', attributes: scriptAttrs(`${base}/@vite/client`) },
            { tag: 'script', attributes: scriptAttrs(`${base}/${entry}`) },
        ])
    }

    // Production: keyed manifest lookup (S-F3).
    const chunk = await reader.resolve(entry)
    const tags: ViteAssetTag[] = []
    for (const css of chunk.css ?? []) {
        tags.push({
            tag: 'link',
            attributes: { rel: 'stylesheet', href: `/${css}`, ...nonceAttr },
        })
    }
    tags.push({ tag: 'script', attributes: scriptAttrs(`/${chunk.file}`) })
    return toResult(tags)
}

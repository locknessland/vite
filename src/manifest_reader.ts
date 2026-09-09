/**
 * @fileoverview `ManifestReader` — the single home for ALL Vite manifest
 * filesystem access (existence, contents, cache) and dev/production **mode
 * detection** (plan §5, A-H1/A-M-mode). Keeping every manifest touch here avoids
 * the TOCTOU split of asking "does it exist?" in one module and "what's in it?"
 * in another.
 *
 * @module @lockness/vite/manifest_reader
 */

import type { LocknessViteConfig } from './shared.ts'

/** One entry in a Vite build manifest. */
export interface ManifestChunk {
    /** The emitted (hashed) file, relative to the output base. */
    file: string
    /** CSS files this chunk depends on. */
    css?: string[]
    /** Other chunks this one imports. */
    imports?: string[]
    /** Whether this chunk is an entry. */
    isEntry?: boolean
    /** The original source path. */
    src?: string
}

/** A parsed Vite build manifest: source key → chunk. */
export type ViteManifest = Record<string, ManifestChunk>

/** The resolved runtime mode. */
export type ViteMode = 'dev' | 'production'

/**
 * Reads and caches the Vite build manifest and decides the runtime mode.
 *
 * Mode is **dev-server-context-first** (A-H1): when running under the Vite dev
 * server the mode is always `dev`, so a manifest left on disk by a prior build
 * never flips a live dev session into production. Only outside the dev server
 * does manifest presence decide `production` vs `dev`.
 */
export class ManifestReader {
    readonly #config: Required<LocknessViteConfig>
    readonly #isDevServer: () => boolean
    #cache: ViteManifest | null = null

    /**
     * @param config - The resolved Lockness Vite config (for `manifestPath`).
     * @param options - `isDevServer`: whether the caller runs under the Vite dev
     *   server (a boolean or a getter). Defaults to `false`.
     */
    constructor(
        config: Required<LocknessViteConfig>,
        options: { isDevServer?: boolean | (() => boolean) } = {},
    ) {
        this.#config = config
        const flag = options.isDevServer ?? false
        this.#isDevServer = typeof flag === 'function' ? flag : () => flag
    }

    /**
     * Whether the manifest file exists on disk.
     * @returns `true` when the manifest is present.
     */
    async exists(): Promise<boolean> {
        try {
            const stat = await Deno.stat(this.#config.manifestPath)
            return stat.isFile
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return false
            throw error
        }
    }

    /**
     * Resolve the runtime mode (dev-server context wins over manifest presence).
     * @returns `'dev'` or `'production'`.
     */
    async mode(): Promise<ViteMode> {
        if (this.#isDevServer()) return 'dev'
        return (await this.exists()) ? 'production' : 'dev'
    }

    /**
     * Read, validate and cache the manifest.
     *
     * @returns The parsed manifest.
     * @throws {Error} When the manifest is missing or malformed — the message
     *   names `manifestPath` so the failure is actionable (never silent).
     */
    async read(): Promise<ViteManifest> {
        if (this.#cache) return this.#cache
        let raw: string
        try {
            raw = await Deno.readTextFile(this.#config.manifestPath)
        } catch (error) {
            throw new Error(
                `@lockness/vite: could not read the Vite manifest at ${this.#config.manifestPath} — run the production build first. (${
                    (error as Error).message
                })`,
            )
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch (error) {
            throw new Error(
                `@lockness/vite: the Vite manifest at ${this.#config.manifestPath} is not valid JSON: ${
                    (error as Error).message
                }`,
            )
        }
        if (typeof parsed !== 'object' || parsed === null) {
            throw new Error(
                `@lockness/vite: the Vite manifest at ${this.#config.manifestPath} must be a JSON object.`,
            )
        }
        this.#cache = parsed as ViteManifest
        return this.#cache
    }

    /**
     * Resolve one entry to its chunk via a **keyed lookup** (never a path built
     * from `entry` — S-F3).
     *
     * @param entry - The manifest key (an app-relative source path).
     * @returns The chunk (`file` + `css`).
     * @throws {Error} When the key is absent — the same actionable failure path.
     */
    async resolve(entry: string): Promise<ManifestChunk> {
        const manifest = await this.read()
        const chunk = manifest[entry]
        if (!chunk) {
            throw new Error(
                `@lockness/vite: entry "${entry}" is not in the manifest at ${this.#config.manifestPath}.`,
            )
        }
        return chunk
    }
}

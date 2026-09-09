/**
 * @fileoverview `lockness:client-entry` virtual-module Vite plugin.
 *
 * Vite needs a single, stable client entrypoint to bundle. Rather than force app
 * authors to keep a file at a fixed path, this plugin serves a **virtual module**
 * (`lockness:client-entry`) that imports the Lockness client runtime (a stub
 * until one exists — Lockness is SSR-first, plan §12) and re-exports the user's
 * `app/client.ts` when it is present. In dev it also pulls in Vite's HMR client.
 *
 * @module @lockness/vite/plugins/client_entry
 */

import type { Plugin } from 'vite'
import { defineViteConfig } from '../define_config.ts'
import type { LocknessViteConfig } from '../shared.ts'

/** The virtual module id app code imports. */
export const CLIENT_ENTRY_ID = 'lockness:client-entry'
/** Its resolved form — the `\0` prefix marks it virtual (Vite convention). */
export const RESOLVED_CLIENT_ENTRY_ID = '\0lockness:client-entry'

/** Options for {@link clientEntry}. */
export interface ClientEntryOptions {
    /** Partial Lockness config; merged over DEFAULTS. */
    config?: Partial<LocknessViteConfig>
}

/**
 * Generate the source of the `lockness:client-entry` virtual module.
 *
 * @param opts - Generation inputs.
 * @param opts.isDev - Whether Vite is running in dev (`serve`) mode.
 * @param opts.clientEntry - The user client-entry path (from config).
 * @param opts.hasUserEntry - Whether that file exists on disk.
 * @returns The virtual module source.
 *
 * @example
 * ```typescript
 * generateClientEntry({ isDev: true, clientEntry: 'app/client.ts', hasUserEntry: false })
 * ```
 */
export function generateClientEntry(opts: {
    isDev: boolean
    clientEntry: string
    hasUserEntry: boolean
}): string {
    const lines: string[] = []
    if (opts.isDev) lines.push(`import '/@vite/client' // dev HMR client`)
    // The Lockness client runtime is a stub until one ships (SSR-first).
    lines.push(
        `// Lockness client runtime (stub — SSR-first, see #109/plan §12)`,
    )
    if (opts.hasUserEntry) {
        lines.push(`export * from '/${opts.clientEntry}'`)
    } else {
        lines.push(`export {} // no ${opts.clientEntry} present`)
    }
    return lines.join('\n') + '\n'
}

/**
 * The `lockness:client-entry` virtual-module plugin.
 *
 * @param options - Optional config.
 * @returns A Vite {@link Plugin} resolving and loading the virtual client entry.
 *
 * @example
 * ```typescript
 * import { clientEntry } from '@lockness/vite'
 * export default { plugins: [clientEntry()] }
 * ```
 */
export function clientEntry(options: ClientEntryOptions = {}): Plugin {
    const config = defineViteConfig(options.config)
    let isDev = false
    return {
        name: 'lockness:client-entry',
        configResolved(resolved: { command: string }) {
            isDev = resolved.command === 'serve'
        },
        resolveId(id: string): string | null {
            return id === CLIENT_ENTRY_ID ? RESOLVED_CLIENT_ENTRY_ID : null
        },
        async load(id: string): Promise<string | null> {
            if (id !== RESOLVED_CLIENT_ENTRY_ID) return null
            let hasUserEntry = false
            try {
                const stat = await Deno.stat(config.clientEntry)
                hasUserEntry = stat.isFile
            } catch (error) {
                // A missing file is the expected "no user entry" case; any other
                // stat error is surfaced (not silently treated as absent).
                if (!(error instanceof Deno.errors.NotFound)) {
                    console.warn(
                        `@lockness/vite: could not stat ${config.clientEntry}: ${
                            (error as Error).message
                        }`,
                    )
                }
            }
            return generateClientEntry({
                isDev,
                clientEntry: config.clientEntry,
                hasUserEntry,
            })
        },
    }
}

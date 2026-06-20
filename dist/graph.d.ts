import { type Section } from './lattice.js';
import type { SectionUrl } from './render/site.js';
/** A directed edge in the section graph (section id → section id). */
export type GraphEdge = {
    source: string;
    target: string;
};
/** Force-directed graph payload consumed by the client renderer. */
export type GraphData = {
    nodes: {
        id: string;
        heading: string;
        url: string;
    }[];
    edges: GraphEdge[];
};
/**
 * Walk the lat.md files once and collect the deduped section→section
 * [[parser#Wiki Links]] edges (source-symbol targets are ignored, self-links
 * dropped). Used by [[cli#serve]]'s `/api/graph`; `lat build` derives the same
 * edges from its already-aggregated link map. See [[cli#graph]].
 */
export declare function collectEdges(latDir: string, projectRoot: string, allSections: Section[]): Promise<GraphEdge[]>;
/**
 * Build the graph payload from sections + edges. Only connected sections (those
 * appearing in at least one edge) become nodes, so isolated sections don't
 * clutter the view. Each node carries its page URL so the renderer can navigate
 * on click. Pure.
 */
export declare function buildGraphData(allSections: Section[], edges: GraphEdge[], sectionUrl: SectionUrl): GraphData;

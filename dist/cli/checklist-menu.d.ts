export interface ChecklistOption {
    label: string;
    value: string;
}
/**
 * Display an interactive multi-select checklist with arrow-key navigation.
 * Returns an array of checked values.
 *
 * Keys: Up/Down (j/k) to move, Space to toggle, Enter to confirm, Ctrl+C to exit.
 * Non-TTY fallback: returns [].
 */
export declare function checklistMenu(options: ChecklistOption[], prompt?: string): Promise<string[]>;

// Lines that start a new visual line even inside a paragraph.
const LIST_ITEM = /^([-*•]\s|\d+[.)]\s|[a-z][.)]\s)/
// ALL-CAPS headings ("WHAT THE TWO LISTS DO"); nothing wraps onto these.
const HEADING = /^[A-Z0-9][A-Z0-9 .,:;'"/()&+-]{3,}$/

/**
 * Split proposal text into paragraphs, each a list of display lines.
 *
 * Proposal descriptions are written in TOML and hard-wrapped at ~72 columns,
 * so a single newline is almost always a wrap, not a break. Splitting on
 * every '\n' (as this used to) turned each wrapped line into its own <p>,
 * which read as a column of fragments. Blank lines separate paragraphs;
 * within one, wrapped lines rejoin with a space (a list item's continuation
 * joins its item) unless the line is a list item or heading.
 */
export const toParagraphs = (text: string): string[][] =>
    text
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map(block => {
            const lines: string[] = []
            for (const raw of block.split('\n')) {
                const line = raw.trim()
                if (!line) {continue}
                const prev = lines.length - 1
                if (
                    prev >= 0 &&
                    !LIST_ITEM.test(line) &&
                    !HEADING.test(line) &&
                    !HEADING.test(lines[prev] ?? '')
                ) {
                    lines[prev] = `${lines[prev]} ${line}`
                } else {
                    lines.push(line)
                }
            }
            return lines
        })
        .filter(lines => lines.length > 0)

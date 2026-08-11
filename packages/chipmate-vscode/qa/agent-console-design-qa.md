# Agent Console design QA

Final result: passed

## Evidence

- Reference: `/var/folders/9s/q5y69fzj3b59lt103v6y4f4m0000gn/T/codex-clipboard-317ff24c-65b7-4964-bca4-990702928da6.png`
- Implementation: `agent-console-hybrid-final.jpg`
- Normalized side-by-side comparison: `agent-console-hybrid-comparison.jpg`
- Story: `agentconsole--approval`

The reference and implementation were inspected at the same wide desktop state. The comparison normalizes both images into equal 1024 x 636 panels.

## States checked

- Dark, light, and high-contrast themes.
- Shell and Agent switching with Shell input preserved after returning from Agent mode.
- The Agent input is a terminal-style line rather than a separate chat composer.
- Direct Shell output, natural-language input, Agent response, and approval render in one chronological surface.
- High-risk command approval in the Agent timeline.
- Edit rejects the original permission before returning the command to the input flow.

## Visual corrections made

- Replaced the Agent chat composer with one terminal-style input line.
- Added extension-host input routing: discovered commands go to the PTY; natural language goes to the local Agent.
- Merged captured PTY output and Agent rows by timestamp in one scrollable timeline.
- Aligned user input to the terminal prompt instead of a right-aligned chat bubble.
- Added a restrained red high-risk surface and a clearly red Execute action across dark and light themes.
- Kept toolbar icons in flex layout and verified wrapping at narrow widths.

## Remaining boundary

The visual pass uses the real shared message and permission components in Storybook. A final Extension Host pass with the real PTY and internal provider remains part of the next packaging gate; this implementation does not claim a packaged VSIX sign-off.

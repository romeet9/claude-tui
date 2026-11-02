// claude-tui never prints images; this stands in for terminal-image (and its 88 MB jimp)
// in the bundled build.
const none = async () => "";
export default { buffer: none, file: none, gifBuffer: () => () => {}, gifFile: () => () => {} };

export function shouldIndexCodeGraphPath(file: string): boolean {
  return !segments(file).some((part) => part === "test" || part === "tests")
}

function segments(file: string): string[] {
  return file
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

// Bun text imports (`with { type: "text" }`) resolve markdown to its contents.
declare module "*.md" {
  const text: string;
  export default text;
}

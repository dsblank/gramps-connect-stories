// Stylesheets: imported for their side effect by the player (a bundler
// handles them), and as text by the embed build, which injects it into its
// shadow root.
declare module "*.css" {
  const text: string;
  export default text;
}

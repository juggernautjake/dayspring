// Pictures from the web, for the no-AI intent catalogue (catalog.mjs), in its template language: (a|b) one of,
// [x] optional, {text} free words, {num} a number. Every one plans { do: "images", id, text } and the runner hands the
// words to lib/image-routes.mjs (which also answers these directly, before anything else, when it's sure).
// The optional 5th item boosts the score when the words clearly mean it.
const SEARCH_WORDS = /\b(pictures?|photos?|images?|pics?|pngs?|gifs?|wallpapers?|clip ?art) (of|for) (?!(my|me|us|our)\b)|\bimage search\b/;
export const IMAGE_INTENTS = [
  ["images.search", "Show pictures of something from the web", "show me pictures of golden retrievers", [
    "(show|find|get|give) me (some )?(pictures|photos|images|pics) of {text}", "(pictures|photos|images|pics) of {text}", "image search [for] {text}",
    "(search|look) (for )?(images|pictures|photos) of {text}", "find (a|an) (transparent png|png|gif|wallpaper|clip art) of {text}",
    "i want to see (pictures|photos|images) of {text}", "(search|google) images (for )?{text}",
  ], (c) => (SEARCH_WORDS.test(c.q) ? 1.35 : 1)],
  ["images.view", "Show one of the pictures bigger", "show number 3 bigger", ["show (number|picture|image) {num} [bigger]", "(zoom in on|enlarge|open) (number|picture|image) {num}", "make (number|picture) {num} bigger"],
    (c) => (/\b(bigger|enlarge|zoom)\b/.test(c.q) && /\b(number|picture|image)\b/.test(c.q) ? 1.35 : 1)],
  ["images.more", "Show more pictures", "more pictures", ["(more|next) (pictures|images|photos)", "show me more (pictures|images|photos)", "next page of (pictures|images)"]],
  ["images.save", "Save one of the pictures", "save that picture", ["save (that|this) (picture|image|photo)", "save (picture|image|number) {num}", "download (that|this) (picture|image)"]],
  ["images.close", "Close the pictures", "close images", ["(close|hide) (the )?(images|pictures|photos)", "no more (pictures|images)"]],
];

// A starting set of morning music for a fresh install: well-known, gentle pieces named by title and artist. With no
// link, each one plays from a YouTube search (or Spotify, when the owner adds a "url"). The owner's own lists live in
// data/devotion.json "playlists" and replace these entirely. by: "preset" = from this starting set.
export const MORNING_PLAYLISTS = {
  "ambient": {
    "name": "Morning Ambient",
    "about": "Soft piano and ambient pieces for waking up and quiet time",
    "tracks": [
      { "title": "Clair de Lune", "artist": "Claude Debussy", "by": "preset" },
      { "title": "Gymnopédie No. 1", "artist": "Erik Satie", "by": "preset" },
      { "title": "Canon in D", "artist": "Johann Pachelbel", "by": "preset" },
      { "title": "Morning Mood", "artist": "Edvard Grieg", "by": "preset" },
      { "title": "Weightless", "artist": "Marconi Union", "by": "preset" },
      { "title": "Spiegel im Spiegel", "artist": "Arvo Pärt", "by": "preset" },
      { "title": "Nuvole Bianche", "artist": "Ludovico Einaudi", "by": "preset" },
      { "title": "Comptine d'un autre été", "artist": "Yann Tiersen", "by": "preset" },
    ],
  },
  "hymns": {
    "name": "Morning Hymns",
    "about": "Instrumental hymns",
    "tracks": [
      { "title": "Be Thou My Vision", "artist": "instrumental hymn", "by": "preset" },
      { "title": "Great Is Thy Faithfulness", "artist": "instrumental hymn", "by": "preset" },
      { "title": "Holy, Holy, Holy", "artist": "instrumental hymn", "by": "preset" },
      { "title": "It Is Well with My Soul", "artist": "instrumental hymn", "by": "preset" },
      { "title": "Come Thou Fount of Every Blessing", "artist": "instrumental hymn", "by": "preset" },
    ],
  },
};

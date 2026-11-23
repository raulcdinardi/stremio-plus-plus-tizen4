'use strict';
// Example site provider (DISABLED by default). Copy and adapt. Contract:
//   find(meta, season, episode) -> [{title, url | pageUrl, headers?, lang}]
// `url` is a direct media URL; `pageUrl` is a web page that the server resolves with yt-dlp (the TV never loads a site).
module.exports = {
  id: 'example',
  name: 'Example site (demo)',
  defaultEnabled: false,
  async find(meta, season, episode) {
    // meta: {id, type, name, year, imdb, tmdb, kitsu}
    // Demo: a public test video through yt-dlp page resolution. A real provider would search the site by meta.name.
    if (meta.name === '__never__') return [];
    return [{ title: meta.name + (season != null ? ' S' + season + 'E' + episode : '') + ' (demo page)', pageUrl: 'https://www.example.com/watch?v=demo', lang: ['en'] }];
  }
};

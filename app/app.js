/* Stremio++ - thin TV client. Plain ES2017, no deps. Built from app-src/ by build.sh */
(function () {
'use strict';

var VERSION = '1.2.0';
var DEFAULT_SERVERS = ['http://192.168.1.10:8790', 'https://relay.example.com:8443/rtv', 'http://192.168.1.11:8790'];
var BASE = '';
var NOOP = function () {};
var $root = document.getElementById('root');
var $modal = document.getElementById('modal');
/* [client] Responsive mode: only the Windows / Android clients (SPP_CLIENT.client set by spp-client.js). On the TV
   (webapis.avplay present, or no client type) RESP is false and every `RESP` branch below is skipped, so the TV keeps
   the fixed 1920x1080 layout. SW = logical stage width (1080 * aspect, set by spp-client.js), RW = width of #root (stage - 110 rail). */
var RESP = !(window.webapis && window.webapis.avplay) && !!(window.SPP_CLIENT && window.SPP_CLIENT.client);
var CLI = RESP ? window.SPP_CLIENT.client : '';
var SW = RESP && window.SPP_CLIENT.stageW ? window.SPP_CLIENT.stageW : 1920;
var RW = SW - 110;
function inputMode() { return RESP ? window.SPP_CLIENT.input || '' : ''; }
function up(el, cls) { while (el && el !== document.body) { if (el.classList && el.classList.contains(cls)) return el; el = el.parentNode; } return null; }
function inside(el, anc) { while (el) { if (el === anc) return true; el = el.parentNode; } return false; }

/* ---------- utils ---------- */
function h(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  var hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  return (hh ? hh + ':' + pad(mm) : '' + mm) + ':' + pad(ss);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
var store = {
  get: function (k, d) {
    try { var v = localStorage.getItem('spp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set: function (k, v) { try { localStorage.setItem('spp.' + k, JSON.stringify(v)); } catch (e) {} }
};
/* One-time migration of the pre-rename localStorage keys (old prefix is built in pieces on purpose); old keys are left in place. */
(function () {
  try {
    var oldP = 'r' + 'tv.', i, k, n = localStorage.length, keys = [];
    for (i = 0; i < n; i++) { k = localStorage.key(i); if (k && k.indexOf(oldP) === 0) keys.push(k); }
    keys.forEach(function (k) { var nk = 'spp.' + k.slice(oldP.length); if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k)); });
  } catch (e) {}
})();
/* ---------- i18n ---------- */
/* Language precedence: the user's pick in Settings (localStorage 'lang')
   > the server setting uiLang (GET /api/settings; remembered in localStorage 'srvlang')
   > the built-in default 'en'. Every request also carries ?lang=<LANG> so the server localizes its own
   strings (labels, messages) in the same language. To add a language: add it to LANGS, LANG_OWN and I18N
   (and to the server's STR/LANG_NAMES in server/util.js and server/api/play.js).
   t('key', a, b) fills {0} {1}; a value may also be a function(a, b) for anything fancier. */
var LANGS = ['en', 'pt'];
var LANG_OWN = { en: 'English', pt: 'Português' };
function normLang(v) { v = String(v == null ? '' : v).toLowerCase().slice(0, 2); return LANGS.indexOf(v) >= 0 ? v : null; }
function pickLang() { return normLang(store.get('lang', null)) || normLang(store.get('srvlang', null)) || 'en'; }
var LANG = pickLang();
document.documentElement.lang = LANG;
var MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var I18N = {
  pt: {
    'nav.home': 'Início', 'nav.search': 'Buscar', 'nav.library': 'Biblioteca', 'nav.history': 'Histórico', 'nav.settings': 'Ajustes',
    'net.badResponse': 'resposta inválida', 'net.error': 'erro {0}', 'net.noConnection': 'sem conexão com o servidor', 'net.timeout': 'o servidor demorou demais',
    'common.loading': 'Carregando…', 'common.retry': 'Tentar de novo', 'common.yes': 'Sim', 'common.no': 'Não', 'common.back': 'Voltar',
    'common.couldNotLoad': 'Não foi possível carregar: {0}',
    'set.saver': 'Economia de dados', 'val.on': 'Ligado', 'val.off': 'Desligado', 'val.subsOff': 'Desligadas',
    'unit.minLeft': '{0} min restantes', 'unit.pctWatched': '{0}% assistido',
    'date.full': function (y, m, d) { return d + '/' + m + '/' + y; },
    'ep.label': 'T{0} E{1}',
    'exit.ask': 'Sair do Stremio++?', 'boot.connecting': 'Conectando ao servidor…',
    'connect.title': 'Servidor Stremio++', 'connect.help': 'Não encontrei o servidor. Digite o endereço (ex.: http://192.168.1.10:8790).',
    'connect.go': 'Conectar', 'connect.testing': 'Testando {0}…', 'connect.noReply': 'Sem resposta em {0}. Confira o endereço e se o servidor está ligado.',
    'src.auto': 'Automático (recomendado)', 'src.autoSub': 'Escolhe a melhor fonte para você', 'src.finding': 'Buscando fontes…',
    'src.none': 'Nenhuma fonte encontrada.', 'src.fail': 'Falha ao buscar fontes: {0}',
    'row.continue': 'Continuar assistindo', 'row.movies': 'Filmes populares', 'row.series': 'Séries populares', 'row.anime': 'Anime em alta',
    'home.empty': 'Nada para mostrar ainda.',
    'lib.empty': 'Sua biblioteca está vazia. Adicione títulos pela tela de detalhes.', 'hist.empty': 'Nada assistido ainda pelo Stremio++.',
    'kp.del': 'apagar', 'kp.space': 'espaço', 'kp.clear': 'limpar', 'kp.numbers': 'digitar números', 'kp.letters': 'voltar às letras',
    'search.ph': 'Buscar filmes, séries e animes', 'search.recent': 'Buscas recentes', 'search.searching': 'Buscando…',
    'search.noResults': 'Nenhum resultado para "{0}"', 'search.error': 'Erro na busca: {0}',
    'search.legend': '<b>Teclas numéricas</b> digitam (2=abc…) &nbsp;·&nbsp; <i style="background:#e5484d"></i>apaga &nbsp;·&nbsp; <i style="background:#30a46c"></i>espaço &nbsp;·&nbsp; <i style="background:#f5c518"></i>limpar &nbsp;·&nbsp; <b>123</b> troca para números &nbsp;·&nbsp; <b>A–Z</b> teclado completo',
    'search.legendGrid': '<b>Setas</b> escolhem a tecla e <b>OK</b> digita &nbsp;·&nbsp; <b>teclas numéricas</b> digitam números &nbsp;·&nbsp; <b>Teclado celular</b> troca o modo',
    'kp.grid': 'teclado completo', 'kp.phone': 'Teclado\ncelular',
    'r100.ep': 'Dê uma nota de 0 a 100 para este episódio', 'r100.movie': 'Dê uma nota de 0 a 100 para este filme',
    'r100.hintDpad': '◀ ▶ ±1  ·  ▲ ▼ ±10  ·  OK salva  ·  Voltar pula', 'r100.hintDigits': 'Digite com as teclas numéricas  ·  OK salva  ·  Voltar pula',
    'r100.saved': 'Nota {0} salva', 'r100.local': 'Nota {0} guardada na TV (o servidor ainda não aceita notas)', 'r100.fail': 'Nota {0} guardada na TV; envio falhou ({1})',
    'r100.next': 'Próximo episódio em {0} s', 'r100.nextWait': 'O próximo episódio começa depois da nota',
    'rate.r100ep': '▼  nota de 0 a 100 para o episódio {0}', 'rate.r100movie': '▼  nota de 0 a 100 para o filme',
    'detail.specials': 'Especiais', 'detail.season': 'Temporada {0}', 'detail.continue': 'Continuar {0}', 'detail.watch': 'Assistir',
    'detail.library': 'Biblioteca', 'detail.rate': 'Avaliar', 'detail.unmark': 'Desmarcar', 'detail.mark': 'Marcar visto',
    'detail.yourRating': 'Sua nota: ', 'detail.noRating': 'Sem nota  ', 'detail.sources': 'Fontes', 'detail.episode': 'Episódio {0}',
    'rate.title': 'Sua nota', 'rate.hint': '{0} de 5  ·  OK confirma  ·  Voltar cancela', 'rate.none': 'Sem nota  ·  OK remove a nota',
    'set.title': 'Ajustes', 'set.server': 'Servidor', 'set.audio': 'Idioma do áudio', 'set.subs': 'Idioma das legendas',
    'set.skip': 'Pular abertura/encerramento automaticamente', 'set.subSize': 'Legenda: tamanho', 'set.subColor': 'Legenda: cor',
    'set.subBg': 'Legenda: fundo', 'set.subPos': 'Legenda: posição', 'set.appLang': 'Idioma do app', 'set.about': 'Sobre o Stremio++',
    'set.notConnected': 'não conectado', 'set.hostEx': 'http://servidor:8790', 'set.note': 'As fontes (addons e sites) são gerenciadas pelo celular ou PC em: {0}/admin',
    'set.saveFail': 'Não consegui salvar: {0}', 'set.readFail': 'Não consegui ler os ajustes do servidor ({0}). Mostrando padrões.',
    'set.kb': 'Teclado da busca', 'kb.grid': 'Grade de letras', 'kb.phone': 'Teclado de celular',
    'set.rateIn': 'Nota 0–100: como digitar', 'ri.dpad': 'Setas (◀▶ ±1, ▲▼ ±10)', 'ri.digits': 'Teclas numéricas', 'set.ratePrompt': 'Pedir nota ao terminar',
    'set.noReply': 'Sem resposta em {0} (mantive {1}).', 'set.preview': 'Assim fica a legenda.\nSegunda linha.',
    'lang.pt': 'Português', 'lang.en': 'Inglês', 'lang.ja': 'Japonês', 'lang.off': 'Desligadas',
    'sz.small': 'Pequeno', 'sz.medium': 'Médio', 'sz.large': 'Grande', 'sz.huge': 'Enorme', 'col.white': 'Branco', 'col.yellow': 'Amarelo',
    'bg.box': 'Caixa translúcida', 'bg.outline': 'Contorno', 'bg.solid': 'Caixa escura', 'pos.bottom': 'Embaixo', 'pos.higher': 'Mais alto',
    'pl.mock': '(vídeo simulado — AVPlay indisponível neste navegador)',
    'skip.intro': 'Pular abertura', 'skip.outro': 'Pular encerramento', 'skip.recap': 'Pular recapitulação', 'skip.auto': ' (automático)',
    'next.label': 'A SEGUIR', 'next.hint': 'OK reproduz agora  ·  Voltar cancela', 'next.default': 'Próximo episódio', 'next.count': 'Começa em {0} s',
    'err.other': 'Outra fonte', 'err.playback': 'Erro de reprodução', 'err.generic': 'erro', 'err.noSources': 'Nenhuma fonte encontrada',
    'err.prepTimeout': 'tempo esgotado ao preparar o vídeo', 'err.player': 'falha do player', 'err.seek': 'Falha ao avançar: {0}',
    'err.lowMem': 'Memória baixa na TV — parei o vídeo para não travar',
    'xd.loadFail': 'A dublagem de outra fonte não carregou · áudio original', 'xd.failBack': 'A dublagem de outra fonte falhou · voltei ao áudio original',
    'xd.found': 'Dublagem PT-BR encontrada · menu Áudio para usar', 'xd.msg': 'Dublagem: {0}', 'xd.notFound': 'não encontrada',
    'xd.switching': 'Trocando para a dublagem de outra fonte…',
    'sub.on': 'Legenda: {0}  ·  ▼ desliga', 'sub.named': 'Legenda: {0}', 'sub.off': 'Legendas desligadas  ·  ▼ liga de novo', 'sub.none': 'Sem legendas para este vídeo',
    'sub.nudge': 'Legenda {0}', 'sub.later': ' (mais tarde)', 'sub.earlier': ' (mais cedo)',
    'sub.syncFail': 'Não consegui sincronizar a legenda sozinho · ajuste em Legendas', 'sub.synced': 'Legenda sincronizada automaticamente ({0})',
    'sub.syncOff': 'Sincronia automática desligada',
    'pn.sources': 'Fontes', 'pn.episodes': 'Episódios', 'pn.audio': 'Áudio', 'pn.subs': 'Legendas', 'pn.epsFail': 'Não consegui carregar a lista de episódios',
    'pn.season': 'TEMPORADA {0}', 'pn.specials': 'ESPECIAIS', 'pn.playing': '  (assistindo)', 'pn.watched': '  · visto', 'pn.noEps': 'Nenhum episódio encontrado',
    'pn.oneAudio': 'Faixa de áudio única', 'pn.track': 'Faixa {0}', 'pn.experimental': 'EXPERIMENTAL',
    'pn.xfind': 'Procurar dublagem PT-BR em outra fonte', 'pn.xagain': 'Procurar de novo ({0})', 'pn.xnone': 'não achei',
    'pn.xrun': 'Procurando dublagem em outras fontes… o vídeo segue', 'pn.xuse': 'Usar dublagem PT-BR (outra fonte)',
    'pn.syncHead': 'SINCRONIA  ·  ◀ ▶ ajustam ao vivo', 'pn.speedFixed': ' · velocidade corrigida',
    'sync.unneeded': 'Automática: desnecessária (legenda do próprio arquivo) · OK força', 'sync.ready': 'Automática: OK para sincronizar',
    'sync.running': 'Automática: analisando… (o vídeo segue)', 'sync.on': 'Automática: ligada', 'sync.alreadyOk': ' · já estava certa', 'sync.onTail': ' · OK desliga',
    'sync.off': 'Automática: desligada · OK liga', 'sync.unsure': 'Automática: não tive certeza · OK tenta de novo', 'sync.failed': 'Automática: falhou ({0}) · OK tenta de novo',
    'sync.fine': '◀  {0} (manual)  ▶     passo 0,1 s', 'sync.coarse': '◀  {0} (manual)  ▶     passo 1 s', 'sync.zero': 'Zerar ajuste manual',
    'tt.audio': 'Trocando áudio…', 'tt.source': 'Trocando de fonte…',
    'r100.hintPtr': 'Arraste, digite ou use as setas  ·  Enter salva  ·  Esc pula', 'r100.save': 'Salvar', 'r100.skip': 'Pular',
    'kp.toggle': 'Teclado na tela', 'pl.muted': 'Som desligado', 'pl.unmuted': 'Som ligado', 'pl.volume': 'Volume {0}%'
  },
  en: {
    'nav.home': 'Home', 'nav.search': 'Search', 'nav.library': 'Library', 'nav.history': 'History', 'nav.settings': 'Settings',
    'net.badResponse': 'invalid response', 'net.error': 'error {0}', 'net.noConnection': 'no connection to the server', 'net.timeout': 'the server took too long',
    'common.loading': 'Loading…', 'common.retry': 'Try again', 'common.yes': 'Yes', 'common.no': 'No', 'common.back': 'Back',
    'common.couldNotLoad': 'Could not load: {0}',
    'set.saver': 'Data saver', 'val.on': 'On', 'val.off': 'Off', 'val.subsOff': 'Off',
    'unit.minLeft': '{0} min left', 'unit.pctWatched': '{0}% watched',
    'date.full': function (y, m, d) { return MON_EN[+m - 1] + ' ' + (+d) + ', ' + y; },
    'ep.label': 'S{0} E{1}',
    'exit.ask': 'Exit Stremio++?', 'boot.connecting': 'Connecting to the server…',
    'connect.title': 'Stremio++ server', 'connect.help': 'Server not found. Enter its address (e.g. http://192.168.1.10:8790).',
    'connect.go': 'Connect', 'connect.testing': 'Testing {0}…', 'connect.noReply': 'No response from {0}. Check the address and that the server is running.',
    'src.auto': 'Automatic (recommended)', 'src.autoSub': 'Picks the best source for you', 'src.finding': 'Finding sources…',
    'src.none': 'No sources found.', 'src.fail': 'Failed to find sources: {0}',
    'row.continue': 'Continue watching', 'row.movies': 'Popular movies', 'row.series': 'Popular series', 'row.anime': 'Trending anime',
    'home.empty': 'Nothing to show yet.',
    'lib.empty': 'Your library is empty. Add titles from the details screen.', 'hist.empty': 'Nothing watched in Stremio++ yet.',
    'kp.del': 'delete', 'kp.space': 'space', 'kp.clear': 'clear', 'kp.numbers': 'type numbers', 'kp.letters': 'back to letters',
    'search.ph': 'Search movies, series and anime', 'search.recent': 'Recent searches', 'search.searching': 'Searching…',
    'search.noResults': 'No results for "{0}"', 'search.error': 'Search error: {0}',
    'search.legend': '<b>Number keys</b> type (2=abc…) &nbsp;·&nbsp; <i style="background:#e5484d"></i>delete &nbsp;·&nbsp; <i style="background:#30a46c"></i>space &nbsp;·&nbsp; <i style="background:#f5c518"></i>clear &nbsp;·&nbsp; <b>123</b> switches to numbers &nbsp;·&nbsp; <b>A–Z</b> full keyboard',
    'search.legendGrid': '<b>Arrows</b> pick a key and <b>OK</b> types it &nbsp;·&nbsp; <b>number keys</b> type digits &nbsp;·&nbsp; <b>Phone keypad</b> switches the mode',
    'kp.grid': 'full keyboard', 'kp.phone': 'Phone\nkeypad',
    'r100.ep': 'Rate this episode from 0 to 100', 'r100.movie': 'Rate this movie from 0 to 100',
    'r100.hintDpad': '◀ ▶ ±1  ·  ▲ ▼ ±10  ·  OK saves  ·  Back skips', 'r100.hintDigits': 'Type it with the number keys  ·  OK saves  ·  Back skips',
    'r100.saved': 'Rating {0} saved', 'r100.local': "Rating {0} kept on the TV (the server doesn't accept ratings yet)", 'r100.fail': 'Rating {0} kept on the TV; upload failed ({1})',
    'r100.next': 'Next episode in {0} s', 'r100.nextWait': 'The next episode starts after you rate',
    'rate.r100ep': '▼  rate episode {0} from 0 to 100', 'rate.r100movie': '▼  rate the movie from 0 to 100',
    'detail.specials': 'Specials', 'detail.season': 'Season {0}', 'detail.continue': 'Continue {0}', 'detail.watch': 'Watch',
    'detail.library': 'Library', 'detail.rate': 'Rate', 'detail.unmark': 'Mark unwatched', 'detail.mark': 'Mark watched',
    'detail.yourRating': 'Your rating: ', 'detail.noRating': 'Not rated  ', 'detail.sources': 'Sources', 'detail.episode': 'Episode {0}',
    'rate.title': 'Your rating', 'rate.hint': '{0} of 5  ·  OK confirms  ·  Back cancels', 'rate.none': 'Not rated  ·  OK clears the rating',
    'set.title': 'Settings', 'set.server': 'Server', 'set.audio': 'Audio language', 'set.subs': 'Subtitle language',
    'set.skip': 'Skip intro/credits automatically', 'set.subSize': 'Subtitles: size', 'set.subColor': 'Subtitles: color',
    'set.subBg': 'Subtitles: background', 'set.subPos': 'Subtitles: position', 'set.appLang': 'App language', 'set.about': 'About Stremio++',
    'set.notConnected': 'not connected', 'set.hostEx': 'http://server:8790', 'set.note': 'Sources (add-ons and sites) are managed from your phone or PC at: {0}/admin',
    'set.saveFail': "Couldn't save: {0}", 'set.readFail': "Couldn't read the server settings ({0}). Showing defaults.",
    'set.kb': 'Search keyboard', 'kb.grid': 'Letter grid', 'kb.phone': 'Phone keypad',
    'set.rateIn': '0–100 rating: input', 'ri.dpad': 'Arrows (◀▶ ±1, ▲▼ ±10)', 'ri.digits': 'Number keys', 'set.ratePrompt': 'Ask for a rating when finished',
    'set.noReply': 'No response from {0} (kept {1}).', 'set.preview': 'This is how subtitles look.\nSecond line.',
    'lang.pt': 'Portuguese', 'lang.en': 'English', 'lang.ja': 'Japanese', 'lang.off': 'Off',
    'sz.small': 'Small', 'sz.medium': 'Medium', 'sz.large': 'Large', 'sz.huge': 'Huge', 'col.white': 'White', 'col.yellow': 'Yellow',
    'bg.box': 'Translucent box', 'bg.outline': 'Outline', 'bg.solid': 'Dark box', 'pos.bottom': 'Bottom', 'pos.higher': 'Higher',
    'pl.mock': '(simulated video — AVPlay unavailable in this browser)',
    'skip.intro': 'Skip intro', 'skip.outro': 'Skip credits', 'skip.recap': 'Skip recap', 'skip.auto': ' (automatic)',
    'next.label': 'UP NEXT', 'next.hint': 'OK plays now  ·  Back cancels', 'next.default': 'Next episode', 'next.count': 'Starts in {0} s',
    'err.other': 'Other source', 'err.playback': 'Playback error', 'err.generic': 'error', 'err.noSources': 'No sources found',
    'err.prepTimeout': 'timed out preparing the video', 'err.player': 'player failure', 'err.seek': 'Seek failed: {0}',
    'err.lowMem': 'Low memory on the TV — stopped the video to avoid freezing',
    'xd.loadFail': "The dub from another source didn't load · original audio", 'xd.failBack': 'The dub from another source failed · back to the original audio',
    'xd.found': 'PT-BR dub found · use it from the Audio menu', 'xd.msg': 'Dub: {0}', 'xd.notFound': 'not found',
    'xd.switching': 'Switching to the dub from another source…',
    'sub.on': 'Subtitles: {0}  ·  ▼ turns off', 'sub.named': 'Subtitles: {0}', 'sub.off': 'Subtitles off  ·  ▼ turns back on', 'sub.none': 'No subtitles for this video',
    'sub.nudge': 'Subtitles {0}', 'sub.later': ' (later)', 'sub.earlier': ' (earlier)',
    'sub.syncFail': "Couldn't sync the subtitles automatically · adjust them under Subtitles", 'sub.synced': 'Subtitles synced automatically ({0})',
    'sub.syncOff': 'Automatic sync turned off',
    'pn.sources': 'Sources', 'pn.episodes': 'Episodes', 'pn.audio': 'Audio', 'pn.subs': 'Subtitles', 'pn.epsFail': "Couldn't load the episode list",
    'pn.season': 'SEASON {0}', 'pn.specials': 'SPECIALS', 'pn.playing': '  (now playing)', 'pn.watched': '  · watched', 'pn.noEps': 'No episodes found',
    'pn.oneAudio': 'Single audio track', 'pn.track': 'Track {0}', 'pn.experimental': 'EXPERIMENTAL',
    'pn.xfind': 'Look for a PT-BR dub in another source', 'pn.xagain': 'Search again ({0})', 'pn.xnone': 'nothing found',
    'pn.xrun': 'Looking for a dub in other sources… the video keeps playing', 'pn.xuse': 'Use PT-BR dub (other source)',
    'pn.syncHead': 'SYNC  ·  ◀ ▶ adjust live', 'pn.speedFixed': ' · speed fixed',
    'sync.unneeded': 'Automatic: not needed (embedded in the file) · OK forces it', 'sync.ready': 'Automatic: OK to sync',
    'sync.running': 'Automatic: analyzing… (video keeps playing)', 'sync.on': 'Automatic: on', 'sync.alreadyOk': ' · in sync', 'sync.onTail': ' · OK turns off',
    'sync.off': 'Automatic: off · OK turns on', 'sync.unsure': 'Automatic: not sure · OK tries again', 'sync.failed': 'Automatic: failed ({0}) · OK tries again',
    'sync.fine': '◀  {0} (manual)  ▶     step 0.1 s', 'sync.coarse': '◀  {0} (manual)  ▶     step 1 s', 'sync.zero': 'Reset manual adjustment',
    'tt.audio': 'Switching audio…', 'tt.source': 'Switching source…',
    'r100.hintPtr': 'Drag, type or use the arrows  ·  Enter saves  ·  Esc skips', 'r100.save': 'Save', 'r100.skip': 'Skip',
    'kp.toggle': 'On-screen keyboard', 'pl.muted': 'Muted', 'pl.unmuted': 'Sound on', 'pl.volume': 'Volume {0}%'
  }
};
function t(key) {
  var v = (I18N[LANG] || I18N.en)[key];
  if (v == null) v = I18N.en[key];
  if (v == null) return key;
  var a = arguments;
  if (typeof v === 'function') return v.apply(null, Array.prototype.slice.call(a, 1));
  return v.replace(/\{(\d+)\}/g, function (m, i) { return a[+i + 1] != null ? a[+i + 1] : ''; });
}
function tx(el, x, y) { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
function release(el) {
  var l = el.getElementsByTagName('img');
  for (var i = 0; i < l.length; i++) { l[i].onerror = null; l[i].removeAttribute('src'); }
}
function removeNode(n) { release(n); if (n.parentNode) n.parentNode.removeChild(n); }
function imgUrl(rel, w) {
  if (!rel) return '';
  if (/^https?:/.test(rel)) return rel;
  if (w) rel = rel.replace(/([?&])w=\d+/, '$1w=' + w);
  return BASE + rel;
}
function mkImg(src) {
  var i = document.createElement('img');
  i.draggable = false;
  i.onerror = function () { this.style.display = 'none'; };
  i.src = src;
  return i;
}
/* keyed window sync for virtualized lists */
function sync(nodes, strip, lo, hi, make) {
  for (var k in nodes) {
    var i = +k;
    if (i < lo || i > hi) { removeNode(nodes[k]); delete nodes[k]; }
  }
  for (var j = lo; j <= hi; j++) {
    if (!nodes[j]) { var n = make(j); strip.appendChild(n); nodes[j] = n; }
  }
}
function clearNodes(nodes) { for (var k in nodes) { removeNode(nodes[k]); delete nodes[k]; } }
function setF(el, on) { if (el) { if (on) el.classList.add('f'); else el.classList.remove('f'); } }

/* ---------- http + cache ---------- */
function xhr(method, path, body, timeout, absolute) {
  return new Promise(function (res, rej) {
    var x = new XMLHttpRequest();
    x.open(method, absolute ? path : BASE + path + (path.indexOf('?') < 0 ? '?' : '&') + 'lang=' + LANG, true);
    x.timeout = timeout || 8000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) {
        try { res(x.responseText ? JSON.parse(x.responseText) : {}); } catch (e) { rej(new Error(t('net.badResponse'))); }
      } else {
        var msg = t('net.error', x.status);
        try { var j = JSON.parse(x.responseText); if (j && j.error) msg = String(j.error); } catch (e) {}
        var er = new Error(msg); er.status = x.status; rej(er);
      }
    };
    x.onerror = function () { rej(new Error(t('net.noConnection'))); };
    x.ontimeout = function () { rej(new Error(t('net.timeout'))); };
    x.send(body !== undefined ? JSON.stringify(body) : null);
  });
}
var cache = new Map();
var inflight = {};
var CMAX = 40;
function cget(path, ttl, timeout) {
  ttl = ttl == null ? 120000 : ttl;
  var e = cache.get(path);
  if (e && Date.now() - e.t < ttl) { cache.delete(path); cache.set(path, e); return Promise.resolve(e.v); }
  if (inflight[path]) return inflight[path];
  var p = xhr('GET', path, undefined, timeout).then(function (v) {
    delete inflight[path];
    cache.set(path, { t: Date.now(), v: v });
    while (cache.size > CMAX) cache.delete(cache.keys().next().value);
    return v;
  }, function (er) { delete inflight[path]; throw er; });
  inflight[path] = p;
  return p;
}
function post(path, body, timeout) { return xhr('POST', path, body, timeout || 10000); }
function metaPath(it) { return '/api/meta/' + it.type + '/' + encodeURIComponent(it.id); }

/* ---------- keys ---------- */
function keyName(e, editing) {
  switch (e.keyCode) {
    case 37: return 'left'; case 38: return 'up'; case 39: return 'right'; case 40: return 'down';
    case 13: return 'enter';
    case 10009: case 27: return 'back';
    case 8: return editing ? null : (RESP && modalState && modalState.key ? 'minus' : 'back'); // rating prompt: Backspace erases a digit
    case 10252: case 32: return 'toggle';
    case 415: return 'play'; case 19: return 'pause'; case 413: return 'stop';
    case 417: return 'ff'; case 412: return 'rw';
    case 427: case 33: return 'chup'; case 428: case 34: return 'chdn';
    case 65376: return 'done'; case 65385: return 'cancel';
    case 403: return 'red'; case 404: return 'green'; case 405: return 'yellow'; case 406: return 'blue';
    case 10221: return 'cc';
    case 189: case 109: case 10190: return 'minus';
  }
  if (e.keyCode >= 48 && e.keyCode <= 57) return 'n' + (e.keyCode - 48);
  if (e.keyCode >= 96 && e.keyCode <= 105) return 'n' + (e.keyCode - 96);
  return 'other';
}
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      var names = ['MediaPlay', 'MediaPause', 'MediaStop', 'MediaPlayPause', 'MediaFastForward', 'MediaRewind',
        'ChannelUp', 'ChannelDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Minus', 'PreviousChannel', 'Caption'];
      var ok = false;
      try { if (tizen.tvinputdevice.registerKeyBatch) { tizen.tvinputdevice.registerKeyBatch(names); ok = true; } } catch (e) {}
      if (!ok) names.forEach(function (n) { try { tizen.tvinputdevice.registerKey(n); } catch (e) {} });
    }
  } catch (e) {}
}

var editInput = null, editDone = null;
function startEdit(input, done) {
  editInput = input; editDone = done;
  input.focus();
}
function endEdit(commit) {
  if (!editInput) return;
  var i = editInput, d = editDone;
  editInput = null; editDone = null;
  i.blur();
  if (d) d(commit);
}

/* ---------- modal ---------- */
var modalState = null;
function openModal(text, btns, def) {
  modalState = { btns: btns, i: def || 0, els: [] };
  $modal.textContent = '';
  var box = h('div', 'box');
  box.appendChild(h('div', 't', text));
  btns.forEach(function (b, i) {
    var el = h('div', 'btn' + (i === modalState.i ? ' f' : ''), b.label);
    box.appendChild(el); modalState.els.push(el);
  });
  $modal.appendChild(box);
  $modal.classList.remove('hid');
}
function closeModal() { modalState = null; $modal.className = 'hid'; $modal.textContent = ''; }
function modalKey(k) {
  var m = modalState;
  if (m.key) { m.key(k); return; } // custom modal (rating prompt) handles its own keys
  if (k === 'left' || k === 'right') {
    setF(m.els[m.i], false);
    m.i = clamp(m.i + (k === 'left' ? -1 : 1), 0, m.btns.length - 1);
    setF(m.els[m.i], true);
  } else if (k === 'enter') {
    var fn = m.btns[m.i].fn; closeModal(); if (fn) fn();
  } else if (k === 'back') { closeModal(); }
}

/* ---------- toast that survives screen changes ---------- */
var gToastEl = null, gToastTimer = 0;
function gToast(msg) {
  if (!gToastEl) { gToastEl = h('div', 'toast gtoast hid'); gToastEl.appendChild(h('span')); document.body.appendChild(gToastEl); }
  gToastEl.firstChild.textContent = msg; gToastEl.classList.remove('hid');
  clearTimeout(gToastTimer); gToastTimer = setTimeout(function () { gToastEl.classList.add('hid'); }, 3000);
}

/* ---------- 0-100 rating of one episode / movie (POST /api/rate100) ----------
   Every score is also kept on the TV ('r100:<itemId>|<videoId>'); scores the server did not take
   (no /api/rate100 yet, offline) wait in 'r100q' and are re-sent after the next successful rating. */
function r100Key(itemId, videoId) { return 'r100:' + itemId + '|' + videoId; }
function r100Local(itemId, videoId) { var v = store.get(r100Key(itemId, videoId), null); return typeof v === 'number' ? v : null; }
function r100Same(a, b) { return a.itemId === b.itemId && a.videoId === b.videoId; }
function r100Flush() {
  var q = store.get('r100q', []);
  if (!q.length) return;
  var b = q[0];
  post('/api/rate100', b, 8000).then(function () {
    store.set('r100q', store.get('r100q', []).filter(function (x) { return !r100Same(x, b); }));
    r100Flush();
  }, NOOP);
}
function r100Save(b) {
  store.set(r100Key(b.itemId, b.videoId), b.score); store.set('r100last:' + b.itemId, b.score);
  post('/api/rate100', b, 8000).then(function () {
    store.set('r100q', store.get('r100q', []).filter(function (x) { return !r100Same(x, b); }));
    gToast(t('r100.saved', b.score)); r100Flush();
  }, function (er) {
    var q = store.get('r100q', []).filter(function (x) { return !r100Same(x, b); });
    q.push(b); store.set('r100q', q.slice(-50));
    gToast(er.status === 404 ? t('r100.local', b.score) : t('r100.fail', b.score, er.message));
  });
}
/* Opens the rating modal. o: { itemId, videoId, type, name, label, movie, cls, onDone(score|null) }.
   Input (server setting ratingInput): 'dpad' = ◀▶ ±1, ▲▼ ±10; 'digits' = number keys, up to 3 digits
   (the D-pad and number keys work in both). OK saves, Back skips. Returns { close, touched, note }. */
function openRate100(o) {
  var digits = srvSet('ratingInput', 'dpad') === 'digits';
  var v = r100Local(o.itemId, o.videoId), known = v != null;
  if (v == null) v = store.get('r100last:' + o.itemId, null);
  if (v == null && !digits) v = 70;
  var buf = '', touched = false, done = false;
  $modal.textContent = ''; $modal.className = 'r100' + (o.cls ? ' ' + o.cls : '');
  var box = h('div', 'box');
  box.appendChild(h('div', 't', t(o.movie ? 'r100.movie' : 'r100.ep')));
  box.appendChild(h('div', 'rs ell', [o.name, o.label].filter(Boolean).join('  ·  ')));
  var num = h('div', 'rn'), bar = h('div', 'rbar'), fill = h('div', 'rfill');
  bar.appendChild(fill); box.appendChild(num); box.appendChild(bar);
  var sl = null, ni = null, ptr = RESP && inputMode() !== 'pad'; // [client] mouse / touch / keyboard: slider + number field + buttons
  if (ptr) {
    var rr = h('div', 'rrow');
    sl = document.createElement('input'); sl.type = 'range'; sl.min = 0; sl.max = 100; sl.step = 1;
    ni = document.createElement('input'); ni.type = 'number'; ni.min = 0; ni.max = 100; ni.step = 1;
    rr.appendChild(sl); rr.appendChild(ni); box.appendChild(rr);
  }
  box.appendChild(h('div', 'rh', t(ptr ? 'r100.hintPtr' : digits ? 'r100.hintDigits' : 'r100.hintDpad')));
  var noteEl = h('div', 'rnote'); box.appendChild(noteEl);
  var bSave = null, bSkip = null;
  if (ptr) {
    var rb = h('div', 'rbtns'); bSave = h('div', 'btn f', t('r100.save')); bSkip = h('div', 'btn', t('r100.skip'));
    rb.appendChild(bSave); rb.appendChild(bSkip); box.appendChild(rb);
  }
  $modal.appendChild(box);
  function paint() {
    num.textContent = v == null ? '–' : String(v);
    num.classList[buf ? 'add' : 'remove']('typing');
    fill.style.width = (v || 0) + '%';
    if (sl) { sl.value = v == null ? 0 : v; if (document.activeElement !== ni) ni.value = v == null ? '' : v; }
  }
  function finish(score) {
    if (done) return; done = true; closeModal();
    if (score != null) r100Save({ itemId: o.itemId, videoId: o.videoId, type: o.type, name: o.name || '', score: score });
    if (o.onDone) o.onDone(score);
  }
  modalState = { key: function (k) {
    touched = true;
    var d = /^n(\d)$/.exec(k);
    if (d) {
      if (buf.length >= 3 || +(buf + '0') > 100) buf = '';
      buf = buf === '0' ? d[1] : buf + d[1];
      v = Math.min(100, +buf);
    } else if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
      buf = '';
      v = clamp((v == null ? 50 : v) + (k === 'left' ? -1 : k === 'right' ? 1 : k === 'up' ? 10 : -10), 0, 100);
    } else if (k === 'red' || k === 'minus') { buf = buf.slice(0, -1); v = buf ? +buf : (digits ? null : 0); }
    else if (k === 'enter') { if (v != null) finish(v); return; }
    else if (k === 'back' || k === 'stop') { finish(null); return; }
    paint();
  } };
  if (ptr) {
    sl.addEventListener('input', function () { touched = true; buf = ''; v = +sl.value; paint(); });
    ni.addEventListener('input', function () { touched = true; buf = ''; var n = parseInt(ni.value, 10); v = isNaN(n) ? null : clamp(n, 0, 100); paint(); });
    ni.addEventListener('blur', function () { ni.value = v == null ? '' : v; });
    var kk = function (k) { if (k === 'enter') { if (v != null) finish(v); return true; } if (k === 'back') { finish(null); return true; } return false; };
    sl.__sppKey = kk; ni.__sppKey = kk;
    bSave.addEventListener('click', function () { if (v != null) finish(v); });
    bSkip.addEventListener('click', function () { finish(null); });
  }
  paint();
  if (!known) { // the server may already have a score for it (rated on another device)
    xhr('GET', '/api/rate100?itemId=' + encodeURIComponent(o.itemId) + '&videoId=' + encodeURIComponent(o.videoId), undefined, 3000).then(function (r) {
      if (!done && !touched && r && typeof r.score === 'number') { v = r.score; paint(); }
    }, NOOP);
  }
  return {
    close: function () { if (!done) { done = true; closeModal(); } },
    touched: function () { return touched; },
    open: function () { return !done; },
    note: function (s) { noteEl.textContent = s || ''; }
  };
}


/* ---------- inline svg icons ---------- */
var ICONS = {
  home: '<path fill="currentColor" d="M3 11.5L12 4l9 7.5V21h-6.5v-6h-5v6H3z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M15.2 15.2L21 21" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
  lib: '<path fill="currentColor" d="M6 3h12a1 1 0 011 1v17l-7-4.5L5 21V4a1 1 0 011-1z"/>',
  libcheck: '<path fill="currentColor" d="M6 3h12a1 1 0 011 1v17l-7-4.5L5 21V4a1 1 0 011-1z"/><path d="M8.5 10l2.5 2.5 4.5-5" fill="none" stroke="#1b1830" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="9" cy="7" r="2.6" fill="currentColor"/><circle cx="15" cy="12" r="2.6" fill="currentColor"/><circle cx="8" cy="17" r="2.6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 7.5V12l3.2 2.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  play: '<path fill="currentColor" d="M7 4.5v15l13-7.5z"/>',
  pause: '<path fill="currentColor" d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/>',
  star: '<path fill="currentColor" d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7L2.5 9.5l6.6-.8z"/>',
  check: '<path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  cc: '<rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10 10.2a2.4 2.4 0 100 3.6M17 10.2a2.4 2.4 0 100 3.6" fill="none" stroke="currentColor" stroke-width="2"/>',
  audio: '<path fill="currentColor" d="M3.5 9.5v5h4l5.5 4.5V5L7.5 9.5z"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eps: '<rect x="3" y="4" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="13" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="14" y="13" width="7" height="7" rx="1.5" fill="currentColor"/>',
  party: window.SPP ? window.SPP.icon : '',
  src: '<path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  back: '<path d="M14.5 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  chev: '<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
};
function svg(name, size, cls) {
  var s = h('span', 'ic' + (cls ? ' ' + cls : ''));
  s.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' + ICONS[name] + '</svg>';
  return s;
}

/* ---------- left navigation rail ---------- */
var RAIL = [{ n: 'home', ic: 'home', l: 'nav.home' }, { n: 'search', ic: 'search', l: 'nav.search' }, { n: 'library', ic: 'lib', l: 'nav.library' }, { n: 'history', ic: 'clock', l: 'nav.history' }, { n: 'settings', ic: 'gear', l: 'nav.settings' }];
var railFocus = false, railIdx = 0, railEls = [];
(function buildRail() {
  var r = document.getElementById('rail');
  RAIL.forEach(function (it, i) {
    var e = h('div', 'ri'); e.appendChild(svg(it.ic, 40)); e.appendChild(h('div', 'rl', t(it.l)));
    r.appendChild(e); railEls.push(e);
  });
})();
function relabelRail() { for (var i = 0; i < RAIL.length; i++) railEls[i].lastChild.textContent = t(RAIL[i].l); }
function setLang(v) { // user's pick in Settings: persists, relabels the rail, drops cached (server-localized) data
  v = normLang(v); if (!v) return;
  store.set('lang', v); applyLang();
}
function applyLang() {
  LANG = pickLang();
  document.documentElement.lang = LANG;
  relabelRail();
  cache.clear();
}
// Server settings the app needs outside the Settings screen (kept in localStorage for the next start).
var SRV_KEYS = ['kbMode', 'ratingInput', 'ratePrompt'];
var SRV = store.get('srvset', null) || {};
function srvSet(k, d) { return SRV[k] === undefined || SRV[k] === null ? d : SRV[k]; }
function srvKeep(s) {
  if (!s) return;
  SRV_KEYS.forEach(function (k) { if (s[k] !== undefined) SRV[k] = s[k]; });
  store.set('srvset', SRV);
}
// Reads the server's uiLang (used when the user has not picked a language in Settings) and SRV_KEYS. Never rejects.
function syncServerLang() {
  return xhr('GET', '/api/settings', undefined, 2500).then(function (s) {
    var v = normLang(s && s.uiLang);
    if (v) store.set('srvlang', v);
    srvKeep(s);
  }, NOOP).then(function () { if (pickLang() !== LANG) applyLang(); });
}
function railMark(name) {
  for (var i = 0; i < RAIL.length; i++) { if (RAIL[i].n === name) railEls[i].classList.add('cur'); else railEls[i].classList.remove('cur'); }
}
function railOn(on) {
  railFocus = on;
  document.body.classList[on ? 'add' : 'remove']('railf');
  for (var i = 0; i < railEls.length; i++) setF(railEls[i], on && i === railIdx);
}
function focusRail() {
  if (!BASE) return;
  railIdx = 0;
  for (var i = 0; i < RAIL.length; i++) if (RAIL[i].n === nav.name) railIdx = i;
  railOn(true);
}
function railKey(k) {
  if (k === 'up' || k === 'down') { railIdx = clamp(railIdx + (k === 'up' ? -1 : 1), 0, RAIL.length - 1); railOn(true); }
  else if (k === 'right' || k === 'back') railOn(false);
  else if (k === 'enter') {
    var n = RAIL[railIdx].n;
    railOn(false);
    if (n !== nav.name || n === 'home') { nav.stack = []; mount(n, {}); }
  }
}

/* ---------- navigation ---------- */
var Screens = {};
var nav = { stack: [], cur: null, name: null, params: null, memo: {} };
function mount(name, params) {
  if (nav.cur) { try { nav.cur.unmount(); } catch (e) { console.error(e); } }
  release($root);
  $root.textContent = '';
  $root.className = '';
  document.documentElement.classList.remove('playing');
  railOn(false);
  document.documentElement.classList[(name === 'boot' || name === 'connect') ? 'add' : 'remove']('norail');
  railMark(name);
  nav.name = name; nav.params = params || {};
  nav.cur = Screens[name](nav.params);
  nav.cur.mount();
}
function push(name, params) {
  if (nav.cur) nav.stack.push({ name: nav.name, params: nav.params });
  mount(name, params);
}
function replace(name, params) { mount(name, params); }
function pop() {
  var t = nav.stack.pop();
  if (t) mount(t.name, t.params); else mount('home', {});
}
function popTo(name) {
  for (var i = nav.stack.length - 1; i >= 0; i--) {
    if (nav.stack[i].name === name) { nav.stack.length = i + 1; pop(); return; }
  }
  pop();
}

function route(k, e) { // a key name goes to the open modal, else the rail, else the screen
  if (modalState) modalKey(k);
  else if (railFocus) railKey(k);
  else if (nav.cur) nav.cur.key(k, e);
}
var keyStats = [];
document.addEventListener('keydown', function (e) {
  if (RESP && !editInput && clientKey(e)) return;
  var k = keyName(e, !!editInput);
  if (!k) return;
  var t0 = performance.now();
  try {
    if (editInput) {
      if (k === 'enter' || k === 'done') { e.preventDefault(); endEdit(true); }
      else if (k === 'back' || k === 'cancel') { e.preventDefault(); endEdit(false); }
      return;
    }
    if (k === 'other') { if (RESP && letterSearch(e)) return; if (nav.cur && nav.cur.other) nav.cur.other(e); return; }
    e.preventDefault();
    route(k, e);
  } catch (er) { console.error(er); }
  if (window.__measure) { void document.body.offsetWidth; keyStats.push(performance.now() - t0); }
}, true);
document.addEventListener('keyup', function (e) {
  if (nav.cur && nav.cur.keyup && !editInput && !modalState) { try { nav.cur.keyup(keyName(e, false), e); } catch (er) {} }
}, true);

/* =====================================================================
   [client] Windows / Android only: text fields, mouse and touch, live stage resize. spp-client.js calls these through
   window.__spp (pointer, modality, restage); the TV never does.
   ===================================================================== */
// A text field has the focus (search box, rating number, ...): characters, Backspace, Ctrl+A/C/V and IME stay native;
// only Enter / Esc / Up / Down are offered to the field's own handler el.__sppKey(k, e), which returns true if it used the key.
function clientKey(e) {
  var a = document.activeElement;
  if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA')) return false;
  if (e.isComposing || e.keyCode === 229) return true;
  var c = e.keyCode, k = c === 27 || c === 10009 ? 'back' : c === 13 ? 'enter' : c === 40 ? 'down' : c === 38 ? 'up' : null;
  if (k && a.__sppKey && !e.ctrlKey && !e.altKey && !e.metaKey && a.__sppKey(k, e)) e.preventDefault();
  return true;
}
// Typing a letter outside a text field opens Search with it (the new field takes the focus, the key lands in it).
function letterSearch(e) {
  if (!e.isTrusted || e.ctrlKey || e.altKey || e.metaKey || !e.key || e.key.length !== 1 || e.key.toLowerCase() === e.key.toUpperCase()) return false;
  if (modalState || !$modal.classList.contains('hid') || nav.name === 'search' || nav.name === 'player' || nav.name === 'boot' || nav.name === 'connect') return false;
  nav.stack = []; delete nav.memo.search; mount('search', {});
  return true;
}
function modality(m) { if (nav.cur && nav.cur.modality) nav.cur.modality(m); }
// logical stage width changed (window resized / rotated): screens whose layout depends on it rebuild when their derived counts changed
function restage(w) {
  if (!RESP || w === SW) return;
  SW = w; RW = SW - 110;
  var c = nav.cur;
  if (!c || nav.name === 'boot' || nav.name === 'connect') return;
  if (c.restage) { c.restage(); return; }
  if (c.stale && c.stale() && !modalState && $modal.classList.contains('hid') && !editInput) mount(nav.name, nav.params);
}
// Mouse / touch. type: 'move' (hover) | 'click' | 'wheel' (d.dx / d.dy = scroll steps, d.swipe = touch) | 'down' / 'drag' / 'drop' (d.x: a screen may
// capture a drag by returning true from 'down') | 'dblclick'. Each screen maps the element to its own focus index / handler in point().
function pointer(type, el, d) {
  if (!RESP || !el) return false;
  if (type === 'down' || type === 'drag' || type === 'drop') return !!(nav.cur && nav.cur.drag && $modal.classList.contains('hid') && nav.cur.drag(type, el, d));
  if (el.tagName === 'INPUT' && type !== 'wheel' && type !== 'move') return false; // native: caret, selection, slider drag
  var open = !$modal.classList.contains('hid');
  if (open) {
    if (modalState && !modalState.key) { // yes / no box
      var bi = modalState.els.indexOf(up(el, 'btn'));
      if (type === 'move' && bi >= 0 && bi !== modalState.i) { setF(modalState.els[modalState.i], false); modalState.i = bi; setF(modalState.els[bi], true); }
      else if (type === 'click') { if (bi >= 0) { modalState.i = bi; modalKey('enter'); } else if (el === $modal) modalKey('back'); }
    } else if (type === 'click' && el === $modal) route('back'); // custom modals (stars, 0-100): the backdrop is Back, the controls have their own listeners
    return true;
  }
  var ri = railEls.indexOf(up(el, 'ri'));
  if (ri >= 0) {
    if (type === 'move') { if (!railFocus || railIdx !== ri) { railIdx = ri; railOn(true); } } else if (type === 'click') { railIdx = ri; railKey('enter'); }
    return true;
  }
  if (railFocus && type !== 'wheel') railOn(false);
  if (nav.cur && nav.cur.point) return !!nav.cur.point(type, el, d);
  return false;
}
// the three grid-like lists share this: element -> index, hover moves the focus, click opens
function gridPoint(g, type, el, d) {
  if (type === 'wheel') { if (d.dy) g.scroll(d.dy); return true; }
  var i = g.hit(el);
  if (i < 0) return false;
  if (type === 'move') g.setIdx(i); else if (type === 'click') { g.setIdx(i); g.key('enter'); }
  return true;
}

/* ---------- common ui ---------- */
function msgBox(parent, text, spinner, btnLabel) {
  var m = h('div', 'mid');
  if (spinner) m.appendChild(h('div', 'spin'));
  m.appendChild(h('div', 't', text));
  var b = null;
  if (btnLabel) { b = h('div', 'btn f', btnLabel); b.style.marginLeft = '0'; m.appendChild(b); }
  parent.appendChild(m);
  return { el: m, btn: b };
}
function epLabel(season, episode) { return t('ep.label', season, episode); }
function fixLabel(it) {
  var l = it.label || '';
  var rem = it.remaining;
  if (rem == null && it.durationSec > 0 && it.positionSec >= 0) rem = (it.durationSec - it.positionSec) / 60;
  if (rem != null) l += (l ? ' · ' : '') + t('unit.minLeft', Math.max(1, Math.round(rem)));
  else if (it.progress > 0) l += (l ? ' · ' : '') + t('unit.pctWatched', Math.round(it.progress * 100));
  return l;
}
function sigOf(s) {
  return (s.quality || '') + '|' + (s.lang || []).join(',') + '|' + String(s.detail || '').split('·').pop().trim();
}
function exitApp() {
  if (window.SPP_CLIENT && window.SPP_CLIENT.exit) { try { window.SPP_CLIENT.exit(); return; } catch (e) {} }
  try { tizen.application.getCurrentApplication().exit(); } catch (e) { try { window.close(); } catch (e2) {} }
}
function askExit() { openModal(t('exit.ask'), [{ label: t('common.yes'), fn: exitApp }, { label: t('common.no') }], 1); }
function startPlayback(ctx) { push('player', ctx); }

function probe(u) {
  return xhr('GET', u.replace(/\/+$/, '') + '/api/health', undefined, 7000, true).then(function (r) { return !!(r && r.ok); }, function () { return false; });
}
function adopt(v) {
  BASE = v.replace(/\/+$/, ''); store.set('server', BASE); cache.clear(); nav.stack = []; nav.memo = {};
  syncServerLang().then(function () { mount('home', {}); });
}
Screens.boot = function () {
  return {
    mount: function () { msgBox($root, t('boot.connecting'), true); },
    unmount: NOOP, key: NOOP
  };
};
Screens.connect = function () {
  var inp, zone = 0, msg, els = [];
  function edit() { startEdit(inp, RESP ? function (commit) { if (commit) tryConnect(inp.value); } : NOOP); }
  function run() {
    if (zone === 0) edit();
    else if (zone === 1) tryConnect(inp.value);
    else boot();
  }
  function tryConnect(v) {
    v = (v || '').trim();
    if (!/^https?:\/\//.test(v)) v = 'http://' + v;
    msg.textContent = t('connect.testing', v);
    probe(v).then(function (okk) {
      if (okk) adopt(v);
      else msg.textContent = t('connect.noReply', v);
    });
  }
  return {
    mount: function () {
      $root.appendChild(h('div', 'h1', t('connect.title')));
      var d = h('div', 'ab sec', t('connect.help'));
      d.style.cssText = 'left:50px;top:150px;width:' + (SW - 220) + 'px';
      $root.appendChild(d);
      var input = h('div', 'cin f'); input.style.top = '260px';
      inp = document.createElement('input');
      inp.type = 'text'; inp.value = store.get('server', DEFAULT_SERVERS[0]) || DEFAULT_SERVERS[0];
      input.appendChild(inp); $root.appendChild(input);
      var b1 = h('div', 'btn', t('connect.go')); b1.style.cssText = 'position:absolute;left:50px;top:400px;margin:0';
      $root.appendChild(b1);
      var b2 = h('div', 'btn', t('common.retry')); b2.style.cssText = 'position:absolute;left:290px;top:400px;margin:0';
      $root.appendChild(b2);
      msg = h('div', 'ab sec', ''); msg.style.cssText = 'left:50px;top:520px;width:' + (SW - 220) + 'px';
      $root.appendChild(msg);
      els = [input, b1, b2];
      inp.addEventListener('blur', function () { if (editInput === inp) endEdit(false); });
      if (RESP && inputMode() !== 'pad' && CLI !== 'android') edit(); // [client] type the address right away, Enter connects
    },
    unmount: NOOP,
    point: function (type, el) { // [client]
      if (el === inp) return false;
      for (var i = 0; i < els.length; i++) if (inside(el, els[i])) {
        if (type === 'move') { zone = i; els.forEach(function (e, j) { setF(e, j === zone); }); }
        else if (type === 'click') { zone = i; els.forEach(function (e, j) { setF(e, j === zone); }); run(); }
        return true;
      }
      return false;
    },
    key: function (k) {
      if (k === 'up') zone = 0; else if (k === 'down') zone = Math.max(zone, 1);
      else if (k === 'left' && zone > 1) zone--; else if (k === 'right' && zone === 1) zone = 2;
      if (k === 'up' || k === 'down' || k === 'left' || k === 'right') { els.forEach(function (e, i) { setF(e, i === zone); }); return; }
      if (k === 'enter') run();
    }
  };
};
function boot() {
  nav.stack = [];
  mount('boot', {});
  var cands = [];
  var qs = /[?&]server=([^&]+)/.exec(location.search);
  if (qs) store.set('server', decodeURIComponent(qs[1]));
  var saved = store.get('server', null);
  if (saved && /192\.168\.15\.6\b/.test(saved)) saved = null; // old laptop relay: no longer used
  // Prefer the direct home-network path (best quality); then the saved one; then the VPS relay.
  var list = ['http://192.168.1.10:8790', saved];
  var CS = window.SPP_CLIENT && window.SPP_CLIENT.servers; // laptop/phone clients: their own ordered list (e.g. Tailscale first, LAN as fallback)
  if (CS && CS.length) list = (saved && CS.indexOf(saved) < 0 ? [saved] : []).concat(CS); // a server typed in Settings (not in the list) goes first
  else {
    if (/^https?:/.test(location.protocol)) list.push(location.origin);
    list = list.concat(DEFAULT_SERVERS);
  }
  list.forEach(function (u) { if (u) { u = u.replace(/\/+$/, ''); if (cands.indexOf(u) < 0) cands.push(u); } });
  // first reachable candidate in priority order (a slower, lower-priority probe never delays a higher-priority hit)
  var okr = [], chosen = false;
  function pick() {
    if (chosen) return;
    for (var i = 0; i < cands.length; i++) {
      if (okr[i] === undefined) return;
      if (okr[i]) { chosen = true; BASE = cands[i]; if (!(CS && CS.indexOf(BASE) >= 0)) store.set('server', BASE); syncServerLang().then(function () { mount('home', {}); }); return; }
    }
    chosen = true; mount('connect', {});
  }
  cands.forEach(function (u, i) { probe(u).then(function (ok) { okr[i] = !!ok; pick(); }); });
}


/* =====================================================================
   SHARED COMPONENTS: poster grid, stream list
   ===================================================================== */
function makeGrid(parent, o) {
  var wrap = h('div', 'gv');
  wrap.style.cssText = 'left:' + o.left + 'px;top:' + o.top + 'px;width:' + o.width + 'px;height:' + o.height + 'px';
  var strip = h('div', 'strip');
  wrap.appendChild(strip); parent.appendChild(wrap);
  var items = [], gi = 0, nodes = {}, markEl = null, active = true, cols = o.cols, sr = 0; // sr: first visible row (RESP only: scrolling is independent of the focus)
  function vrows() { return Math.max(1, Math.floor(o.height / o.sy)); }
  function ens() { // [client] keep the focused row visible after a key move
    if (!RESP) return;
    var r = Math.floor(gi / cols), vr = vrows();
    if (r < sr) sr = r; else if (r > sr + vr - 1) sr = r - vr + 1;
  }
  function make(i) {
    var it = items[i], c = h('div', 'gc');
    c.style.width = o.cw + 'px';
    c.style.left = ((i % cols) * o.sx) + 'px'; c.style.top = (Math.floor(i / cols) * o.sy) + 'px';
    var im = h('div', 'gimg'); im.style.width = o.cw + 'px'; im.style.height = o.ch + 'px';
    var s = imgUrl(it.poster, o.cw);
    if (s) im.appendChild(mkImg(s)); else im.appendChild(h('div', 'ph', it.name));
    c.appendChild(im);
    c.appendChild(h('div', 'cn', it.name));
    if (it.label) c.appendChild(h('div', 'cl v', it.label));
    return c;
  }
  function top() { return Math.max(0, Math.floor(gi / cols) - 1); }
  function render() {
    if (!items.length) { clearNodes(nodes); return; }
    var t = RESP ? sr : top();
    sync(nodes, strip, Math.max(0, (t - 1) * cols), Math.min(items.length - 1, (t + 3) * cols - 1), make);
    tx(strip, 0, -t * o.sy);
  }
  function mark() { setF(markEl, false); markEl = active ? nodes[gi] || null : null; setF(markEl, true); }
  return {
    el: wrap,
    set: function (list) { items = list || []; gi = 0; sr = 0; clearNodes(nodes); render(); mark(); },
    count: function () { return items.length; },
    setActive: function (b) { active = b; mark(); },
    cur: function () { return items[gi]; },
    row: function () { return Math.floor(gi / cols); },
    setRow: function (r) { gi = clamp(r * cols, 0, Math.max(0, items.length - 1)); ens(); render(); mark(); },
    hit: function (el) { var c = up(el, 'gc'); if (c) for (var k in nodes) if (nodes[k] === c) return +k; return -1; }, // [client]
    setIdx: function (i) { gi = i; mark(); },
    scroll: function (n) { sr = clamp(sr + n, 0, Math.max(0, Math.ceil(items.length / cols) - vrows())); render(); mark(); },
    remove: function () { clearNodes(nodes); removeNode(wrap); },
    // returns 'left' / 'up' / 'right' when focus tries to leave the grid
    key: function (k) {
      var r = Math.floor(gi / cols), c = gi % cols, n = items.length;
      if (k === 'left') { if (c > 0) gi--; else return 'left'; }
      else if (k === 'right') { if (c < cols - 1 && gi + 1 < n) gi++; else return 'right'; }
      else if (k === 'down') { if (gi + cols < n) gi += cols; else if (Math.floor((n - 1) / cols) > r) gi = n - 1; }
      else if (k === 'up') { if (r > 0) gi -= cols; else return 'up'; }
      else if (k === 'chdn') gi = Math.min(n - 1, gi + cols * 2);
      else if (k === 'chup') gi = Math.max(0, gi - cols * 2);
      else if (k === 'enter') { if (items[gi] && o.onOpen) o.onOpen(items[gi]); return 'enter'; }
      ens(); render(); mark(); return null;
    },
    destroy: function () { clearNodes(nodes); }
  };
}

function langBadges(list) {
  var f = h('span');
  (list || []).slice(0, 4).forEach(function (l) {
    var s = String(l), e = h('span', 'lg' + (/^pt/i.test(s) ? ' pt' : ''), s);
    f.appendChild(e);
  });
  return f;
}
/* Stremio-style stream list used by the Detail right panel and the in-player "Fontes" panel */
function makeStreamList(parent, o) {
  var wrap = h('div', 'plist'); wrap.style.top = o.top + 'px'; wrap.style.height = o.height + 'px';
  var strip = h('div', 'strip'); wrap.appendChild(strip); parent.appendChild(wrap);
  var RH = 148, VIS = Math.floor(o.height / RH);
  var rows = [{ auto: true }], idx = 0, off = 0, dead = false, nodes = {}, loadMsg = null, markEl = null, failed = false, ready = false, active = true;
  function mk(i) {
    var s = rows[i], e = h('div', 'sr');
    e.style.top = (i * RH) + 'px';
    if (s.auto) {
      var a = h('div', 'auto');
      a.appendChild(h('div', 'ell bold', t('src.auto')));
      a.appendChild(h('div', 'sec sm ell', t('src.autoSub')));
      e.appendChild(a); return e;
    }
    var parts = String(s.detail || '').split('·').map(function (x) { return x.trim(); }).filter(Boolean);
    var src = parts.length ? parts.pop() : (s.kind || '');
    e.appendChild(h('div', 'sn ell', src));
    e.appendChild(h('div', 'sq ell', s.quality || ''));
    e.appendChild(h('div', 'st', s.title || ''));
    e.appendChild(h('div', 'sd ell', parts.join(' · ')));
    var b = h('div', 'sb'); b.appendChild(langBadges(s.lang)); e.appendChild(b);
    return e;
  }
  function draw() {
    sync(nodes, strip, Math.max(0, off - 2), Math.min(rows.length - 1, off + VIS + 2), mk);
    tx(strip, 0, -off * RH);
    mark();
  }
  function mark() { setF(markEl, false); markEl = active ? nodes[idx] || null : null; setF(markEl, true); }
  function clearMsg() { if (loadMsg) { removeNode(loadMsg.el); loadMsg = null; } }
  function msg(text, spin, btn) {
    clearMsg(); loadMsg = msgBox(wrap, text, spin, btn); loadMsg.el.style.top = '220px'; loadMsg.el.style.fontSize = '26px';
  }
  function load(force) {
    var path = '/api/streams/' + o.type + '/' + encodeURIComponent(o.videoId);
    if (force) cache.delete(path);
    failed = false; ready = false; clearNodes(nodes);
    msg(t('src.finding'), true);
    cget(path, 60000, 40000).then(function (d) {
      if (dead) return;
      clearMsg();
      var list = (d && d.streams) || [];
      if (!list.length) { failed = true; msg(t('src.none'), false, t('common.retry')); return; }
      rows = [{ auto: true }].concat(list); idx = 0;
      var last = store.get('src:' + o.itemId, null);
      if (last) for (var i = 1; i < rows.length; i++) if (sigOf(rows[i]) === last) { idx = i; break; }
      off = clamp(idx - 1, 0, Math.max(0, rows.length - VIS));
      ready = true; draw();
    }, function (er) {
      if (dead) return;
      failed = true; msg(t('src.fail', er.message), false, t('common.retry'));
    });
  }
  load(false);
  var api = {
    setActive: function (b) { active = b; mark(); },
    reload: function () { load(true); },
    scroll: function (n) { if (ready) { off = clamp(off + n, 0, Math.max(0, rows.length - VIS)); draw(); } }, // [client]
    point: function (type, el) {
      if (loadMsg && loadMsg.btn && inside(el, loadMsg.btn)) { if (type === 'click') load(true); return true; }
      var e = up(el, 'sr'), i = -1;
      if (e) for (var k in nodes) if (nodes[k] === e) i = +k;
      if (i < 0) return false;
      if (!ready) return true;
      idx = i; mark();
      if (type === 'click') api.key('enter');
      return true;
    },
    // returns 'left' when focus leaves to the left; true if consumed
    key: function (k) {
      if (k === 'left') return 'left';
      if (failed) { if (k === 'enter') load(true); return true; }
      if (!ready) return true;
      if (k === 'up') idx = Math.max(0, idx - 1);
      else if (k === 'down') idx = Math.min(rows.length - 1, idx + 1);
      else if (k === 'chup') idx = Math.max(0, idx - VIS);
      else if (k === 'chdn') idx = Math.min(rows.length - 1, idx + VIS);
      else if (k === 'enter' || k === 'play') { var s = rows[idx]; if (!s.auto) { store.set('src:' + o.itemId, sigOf(s)); } o.onChoose(s.auto ? null : s); return true; }
      else return true;
      if (idx < off) off = idx; else if (idx > off + VIS - 1) off = idx - VIS + 1;
      draw(); return true;
    },
    destroy: function () { dead = true; clearNodes(nodes); }
  };
  return api;
}

/* =====================================================================
   HOME (Stremio "Board")
   ===================================================================== */
Screens.home = function () {
  var ROW_KEYS = { continue: 'row.continue', movies: 'row.movies', series: 'row.series', anime: 'row.anime' };
  var M = nav.memo.home || (nav.memo.home = { r: 0, c: {} });
  var R = [], fr = M.r, vs, heroImg, heroSrc = '', prefTimer = 0, heroTimer = 0, dead = false, loadMsg = null, markEl = null;
  var STRIDE = 198, ROWH = 440, VIS = RESP ? visFor() : 8, LEAD = 3, sr = 0; // sr: first visible row (RESP: the mouse wheel scrolls independently of the focus)
  function visFor() { return Math.max(3, Math.floor((RW - 50) / STRIDE)); }

  function rowTitle(d) { var k = ROW_KEYS[d.id]; return k ? t(k) : d.title; } // known rows follow the app language; others keep the server's title
  function build(rows) {
    R = []; var y = 0;
    rows.forEach(function (r) {
      if (!r.items || !r.items.length) return;
      R.push({ d: r, top: y, el: null, strip: null, nodes: {}, col: Math.min(M.c[r.id] || 0, r.items.length - 1), off: 0 });
      y += ROWH;
    });
    if (fr >= R.length) fr = R.length - 1;
    if (fr < 0) fr = 0;
    if (RESP) { sr = fr; R.forEach(function (r) { r.off = clamp(r.col - LEAD, 0, Math.max(0, r.d.items.length - VIS)); }); }
  }
  function makeCard(r, i) {
    var it = r.d.items[i], cont = r.d.kind === 'continue';
    var c = h('div', 'pc');
    c.style.left = (i * STRIDE) + 'px';
    var im = h('div', 'pimg');
    var src = imgUrl(it.poster, 170);
    if (src) im.appendChild(mkImg(src)); else im.appendChild(h('div', 'ph', it.name));
    if (cont && it.progress > 0) {
      var pb = h('div', 'pb'), pf = h('div', 'pf');
      pf.style.width = Math.min(100, Math.round(it.progress * 100)) + '%';
      pb.appendChild(pf); im.appendChild(pb);
    }
    c.appendChild(im);
    c.appendChild(h('div', 'cn', it.name));
    if (cont) c.appendChild(h('div', 'cl v', it.label || fixLabel(it)));
    return c;
  }
  function buildRow(i) {
    var r = R[i]; if (r.el) return;
    r.el = h('div', 'row'); r.el.style.top = r.top + 'px'; r.el.style.height = ROWH + 'px';
    r.el.appendChild(h('div', 'rt', rowTitle(r.d)));
    var clip = h('div', 'clip'); clip.style.height = (ROWH - 62) + 'px';
    r.strip = h('div', 'strip'); clip.appendChild(r.strip);
    r.el.appendChild(clip); vs.appendChild(r.el);
  }
  function unbuildRow(i) {
    var r = R[i]; if (!r.el) return;
    clearNodes(r.nodes); removeNode(r.el); r.el = null; r.strip = null;
  }
  function updateRow(i) {
    var r = R[i]; if (!r.el) return;
    var n = r.d.items.length, focused = i === fr;
    var off = RESP ? r.off : clamp(r.col - LEAD, 0, Math.max(0, n - VIS));
    var buf = focused ? 3 : 1;
    sync(r.nodes, r.strip, Math.max(0, off - buf), Math.min(n - 1, off + VIS + buf - 1), function (j) { return makeCard(r, j); });
    tx(r.strip, -off * STRIDE, 0);
  }
  function layout() {
    for (var i = 0; i < R.length; i++) {
      if (Math.abs(i - fr) <= 1 || (RESP && Math.abs(i - sr) <= 2)) { buildRow(i); updateRow(i); } else unbuildRow(i);
    }
    tx(vs, 0, -R[RESP ? sr : fr].top);
    mark();
  }
  function setHero(it) {
    clearTimeout(heroTimer);
    heroTimer = setTimeout(function () {
      cget(metaPath(it)).then(function (m) {
        if (dead || !R[fr] || R[fr].d.items[R[fr].col] !== it) return;
        var s = imgUrl(m.background, 1280);
        if (!s || s === heroSrc) return;
        heroSrc = s; heroImg.style.display = ''; heroImg.src = s;
      }).catch(NOOP);
    }, 400);
  }
  function mark() {
    setF(markEl, false); markEl = null;
    clearTimeout(prefTimer);
    if (R[fr]) {
      markEl = R[fr].nodes[R[fr].col] || null; setF(markEl, true);
      var it = R[fr].d.items[R[fr].col];
      if (it) {
        prefTimer = setTimeout(function () { if (!dead) cget(metaPath(it)).catch(NOOP); }, 300);
        setHero(it);
      }
    }
  }
  function moveCol(c) {
    var r = R[fr]; c = clamp(c, 0, r.d.items.length - 1);
    if (c === r.col) return;
    setF(markEl, false); r.col = c; M.c[r.d.id] = c;
    if (RESP) { if (c < r.off) r.off = c; else if (c > r.off + VIS - 1) r.off = c - VIS + 1; }
    updateRow(fr); mark();
  }
  function moveRow(n) {
    if (n < 0 || n > R.length - 1) return;
    setF(markEl, false);
    fr = n; M.r = fr;
    if (RESP) { if (fr < sr) sr = fr; else if (fr > sr + 1) sr = fr - 1; }
    layout();
  }
  function focusAt(ri, ci) { // [client] hover / click: focus the card under the pointer without scrolling anything
    var r = R[ri];
    if (ri === fr && ci === r.col) return;
    setF(markEl, false);
    if (ri !== fr) { fr = ri; M.r = fr; layout(); }
    R[fr].col = ci; M.c[R[fr].d.id] = ci; updateRow(fr); mark();
  }
  function clearMsg() { if (loadMsg) { removeNode(loadMsg.el); loadMsg = null; } }
  function load(force) {
    clearMsg();
    var path = '/api/home';
    if (force) cache.delete(path);
    var c = cache.get(path);
    if (!(c && Date.now() - c.t < 60000)) loadMsg = msgBox($root, t('common.loading'), true);
    cget(path, 60000, 12000).then(function (d) {
      if (dead) return;
      clearMsg();
      build((d && d.rows) || []);
      if (!R.length) { fail(t('home.empty')); return; }
      layout();
    }, function (er) { if (dead) return; clearMsg(); fail(t('common.couldNotLoad', er.message)); });
  }
  function fail(text) { loadMsg = msgBox($root, text, false, t('common.retry')); R = []; }
  function activate() {
    var r = R[fr], it = r.d.items[r.col];
    if (r.d.kind === 'continue') {
      startPlayback({ type: it.type, itemId: it.id, videoId: it.videoId || it.id, name: it.name, label: it.label || '', startSec: 0, needResume: true, item: it });
    } else push('detail', { type: it.type, id: it.id, item: it });
  }
  return {
    mount: function () {
      var hero = h('div', 'hero'); heroImg = document.createElement('img'); heroImg.style.display = 'none';
      heroImg.onerror = function () { this.style.display = 'none'; heroSrc = ''; };
      hero.appendChild(heroImg); $root.appendChild(hero); $root.appendChild(h('div', 'hero2'));
      vs = h('div', ''); vs.id = 'vs'; $root.appendChild(vs);
      load(false);
    },
    unmount: function () {
      dead = true; clearTimeout(prefTimer); clearTimeout(heroTimer);
      M.r = fr;
      for (var i = 0; i < R.length; i++) clearNodes(R[i].nodes);
      heroImg.removeAttribute('src');
    },
    key: function (k) {
      if (k === 'back') { askExit(); return; }
      if (!R.length) {
        if (k === 'enter') load(true); else if (k === 'left') focusRail();
        return;
      }
      switch (k) {
        case 'left': if (R[fr].col === 0) focusRail(); else moveCol(R[fr].col - 1); break;
        case 'right': moveCol(R[fr].col + 1); break;
        case 'up': moveRow(fr - 1); break;
        case 'down': moveRow(fr + 1); break;
        case 'chup': moveCol(R[fr].col - VIS); break;
        case 'chdn': moveCol(R[fr].col + VIS); break;
        case 'enter': activate(); break;
      }
    },
    stale: function () { return visFor() !== VIS; },
    point: function (type, el, d) { // [client]
      if (!R.length) { if (type === 'click' && up(el, 'btn')) load(true); return true; }
      var i, k, row = up(el, 'row');
      if (type === 'wheel') {
        var wr = fr; for (i = 0; i < R.length; i++) if (row && R[i].el === row) wr = i;
        if (d.dx) { var rr = R[wr]; rr.off = clamp(rr.off + d.dx, 0, Math.max(0, rr.d.items.length - VIS)); updateRow(wr); }
        else if (d.dy) { sr = clamp(sr + d.dy, 0, Math.max(0, R.length - 2)); layout(); }
        return true;
      }
      var pc = up(el, 'pc');
      if (!pc) return false;
      for (i = 0; i < R.length; i++) for (k in R[i].nodes) {
        if (R[i].nodes[k] !== pc) continue;
        focusAt(i, +k);
        if (type === 'click') activate();
        return true;
      }
      return false;
    }
  };
};

/* =====================================================================
   LIBRARY
   ===================================================================== */
function listScreen(key, titleKey, path, emptyKey, onOpen) {
  return function () {
  var grid, dead = false, msg = null, M = nav.memo[key] || (nav.memo[key] = { row: 0 });
  function colsFor() { return RESP ? Math.max(3, Math.floor((RW - 50) / 198)) : 8; }
  var haveCols = colsFor();
  function clearMsg() { if (msg) { removeNode(msg.el); msg = null; } }
  function load(force) {
    clearMsg();
    if (force) cache.delete(path);
    msg = msgBox($root, t('common.loading'), true);
    cget(path, 30000, 10000).then(function (d) {
      if (dead) return; clearMsg();
      var list = (d && d.results) || [];
      if (!list.length) { msg = msgBox($root, t(emptyKey), false); return; }
      grid.set(list); grid.setRow(M.row);
    }, function (er) { if (dead) return; clearMsg(); msg = msgBox($root, t('common.couldNotLoad', er.message), false, t('common.retry')); });
  }
  return {
    mount: function () {
      $root.appendChild(h('div', 'h1', t(titleKey)));
      grid = makeGrid($root, { cols: haveCols, sx: 198, sy: 350, cw: 170, ch: 255, left: 26, top: 140, width: RW - 26, height: 940,
        onOpen: onOpen || function (it) { push('detail', { type: it.type, id: it.id, item: it }); } });
      load(false);
    },
    unmount: function () { dead = true; M.row = grid.row(); grid.destroy(); },
    key: function (k) {
      if (k === 'back') { pop(); return; }
      if (!grid.count()) { if (k === 'enter') load(true); else if (k === 'left') focusRail(); return; }
      var r = grid.key(k);
      if (r === 'left') focusRail();
    },
    stale: function () { return colsFor() !== haveCols; },
    point: function (type, el, d) { return gridPoint(grid, type, el, d); } // [client]
  };
  };
}
Screens.library = listScreen('library', 'nav.library', '/api/library', 'lib.empty');
Screens.history = listScreen('history', 'nav.history', '/api/history', 'hist.empty');

/* =====================================================================
   SEARCH: on-screen keyboard + remote numeric multi-tap
   ===================================================================== */
var MT = { '0': ' 0', '1': ".-'1", '2': 'abc2', '3': 'def3', '4': 'ghi4', '5': 'jkl5', '6': 'mno6', '7': 'pqrs7', '8': 'tuv8', '9': 'wxyz9' };
// phone-style 3x4 keypad (Enter on a key == pressing that digit on the remote)
function kpLetters(d) { return MT[d].replace(/[0-9]/, '').replace(' ', ''); }
// [glyph, label key, role]; the glyph of the 'clr' key is itself a label key; 'mode' = 123/abc, 'kb' = switch to the grid keyboard
var KP = [['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['⌫', 'kp.del', 'del'], ['0', 'kp.space'], ['kp.clear', '', 'clr'], ['123', 'kp.numbers', 'mode'], ['A–Z', 'kp.grid', 'kb']];
// standard grid keyboard for remotes without number keys: 6 columns, D-pad + OK; bottom row [col, span, role]
var GK_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
var GK_BOT = [[0, 2, 'sp'], [2, 1, 'del'], [3, 1, 'clr'], [4, 2, 'kb']];
var GK_PITCH = 93;
function gkBot(c) { for (var i = GK_BOT.length - 1; i >= 0; i--) if (c >= GK_BOT[i][0]) return i; return 0; }
// keyboard mode: the runtime switch (remembered on this TV) wins over the server setting kbMode
function kbModeNow() {
  var m = store.get('kbmode', null);
  if (m === 'grid' || m === 'phone') return m;
  return srvSet('kbMode', 'grid') === 'phone' ? 'phone' : 'grid';
}
Screens.search = function () {
  var M = nav.memo.search || (nav.memo.search = { q: '', zone: 'f', kr: 0, kc: 0, kbPin: null });
  var num = !!M.num, kbBox = null; // num: phone keys type digits directly
  var kbm = kbModeNow(); // 'phone' | 'grid'
  var q = M.q, zone = M.zone, kr = M.kr, kc = M.kc, dead = false, seq = 0, timer = 0, lastQ = null;
  var pend = null; // {key, i, ch}
  var pendTimer = 0;
  var field, textEl, ime, kbEls = [], kbKeys = [], legend, capEl, info, grid, chipEls = [], ci = 0, markEl = null, hasResults = false, chipsWrap;
  /* [client] Windows / Android: the field is a real <input> (physical keyboard, system soft keyboard, IME, paste); the on-screen
     keyboard is only shown to D-pad / gamepad users (or when the user pins it with the toggle in the field). */
  var native = RESP, inp = null, kbBtn = null, kbOn = true, results = [], wantEnter = false, haveCols = 6, scr = null;
  function wantKb() { return !native || (M.kbPin != null ? M.kbPin : inputMode() === 'pad'); }
  function gx() { return kbOn ? 636 : 50; } // left edge of the results
  function gcols() { return Math.max(3, Math.floor((RW - gx() - 4 - 24) / 180)); }
  function canFocus() { return CLI !== 'android' && inputMode() !== 'pad'; } // Android: the soft keyboard only opens on a tap
  function recents() { return store.get('recent', []); }
  function eff() { return q + (pend ? pend.ch : ''); }
  function renderField() {
    if (native) { var v = eff(); if (inp.value !== v) inp.value = v; if (kbLab.length) paintPend(); return; }
    textEl.textContent = '';
    if (!q && !pend) textEl.appendChild(h('span', 'ph2', t('search.ph')));
    if (q) textEl.appendChild(document.createTextNode(q));
    if (pend) textEl.appendChild(h('span', 'pend', pend.ch === ' ' ? ' ' : pend.ch));
    if (zone === 'f') textEl.appendChild(h('span', 'caret'));
    if (kbLab.length) paintPend();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(doSearch, 400); }
  function commitPend() {
    clearTimeout(pendTimer);
    if (pend) { q += pend.ch; pend = null; renderField(); }
  }
  function setQ(v) { q = v; pend = null; clearTimeout(pendTimer); renderField(); schedule(); showChips(); }
  function typeChar(c) { commitPend(); q += c; renderField(); schedule(); showChips(); }
  function backspace() {
    if (pend) { pend = null; clearTimeout(pendTimer); } else q = q.slice(0, -1);
    renderField(); schedule(); showChips();
  }
  function multitap(d) {
    var chars = MT[d];
    if (pend && pend.key === d) { pend.i = (pend.i + 1) % chars.length; pend.ch = chars[pend.i]; }
    else { commitPend(); pend = { key: d, i: 0, ch: chars[0] }; }
    clearTimeout(pendTimer); pendTimer = setTimeout(function () { commitPend(); schedule(); }, 900);
    renderField(); schedule(); showChips();
  }
  function showChips() {
    var show = !eff() && recents().length;
    chipsWrap.classList[show ? 'remove' : 'add']('hid');
    capEl.textContent = show ? t('search.recent') : '';
    if (!chipEls.length || (show && chipEls.length !== recents().length)) buildChips();
  }
  function buildChips() {
    chipsWrap.textContent = ''; chipEls = [];
    recents().slice(0, 8).forEach(function (s, i) {
      var c = h('div', 'rchip ell', s); c.style.top = (240 + i * 80) + 'px'; if (native) c.style.left = (gx() + 34) + 'px'; chipsWrap.appendChild(c); chipEls.push(c);
    });
  }
  function doSearch() {
    var s = eff().trim();
    if (s === lastQ) return; lastQ = s;
    if (s.length < 2) { results = []; grid.set([]); hasResults = false; info.textContent = s ? '' : ''; if (zone === 'r') zone = native && !kbOn ? 'f' : 'k'; mark(); return; }
    var my = ++seq;
    info.textContent = t('search.searching');
    cget('/api/search?q=' + encodeURIComponent(s), 120000, 10000).then(function (d) {
      if (dead || my !== seq) return;
      var res = (d && d.results) || [];
      results = res; grid.set(res); hasResults = res.length > 0;
      info.textContent = res.length ? '' : t('search.noResults', s);
      if (native && wantEnter) { wantEnter = false; if (hasResults) goRight(); }
      mark();
    }, function (er) { if (dead || my !== seq) return; results = []; grid.set([]); hasResults = false; wantEnter = false; info.textContent = t('search.error', er.message); });
  }
  function remember() {
    var s = eff().trim(); if (s.length < 2) return;
    var rc = recents().filter(function (x) { return x.toLowerCase() !== s.toLowerCase(); });
    rc.unshift(s); store.set('recent', rc.slice(0, 8));
  }
  function kbMark() {
    kbEls.forEach(function (e) { setF(e, false); });
    if (zone === 'k') setF(kbEls[kbIndex(kr, kc)], true);
  }
  function kbIndex(r, c) {
    if (kbm === 'grid') return r === 6 ? 36 + gkBot(c) : r * 6 + c;
    return r === 4 ? 12 + (c ? 1 : 0) : r * 3 + c;
  }
  function mark() {
    setF(field, zone === 'f');
    kbMark();
    chipEls.forEach(function (e, i) { setF(e, zone === 'c' && i === ci); });
    grid.setActive(zone === 'r');
    renderField();
    if (native && zone === 'f' && canFocus() && document.activeElement !== inp) inp.focus();
  }
  function pressKey(i) {
    if (kbm === 'grid') {
      var g = kbKeys[i];
      if (g.role === 'sp') typeChar(' '); else if (g.role === 'del') backspace(); else if (g.role === 'clr') setQ('');
      else if (g.role === 'kb') switchKb('phone');
      else typeChar(g.ch);
      return;
    }
    var k = KP[i];
    if (k[2] === 'del') backspace(); else if (k[2] === 'clr') setQ('');
    else if (k[2] === 'mode') { commitPend(); num = !num; M.num = num; paintMode(); }
    else if (k[2] === 'kb') switchKb('grid');
    else if (num) { flash(k[0]); typeChar(k[0]); }
    else multitap(k[0]);
  }
  function paintMode() {
    if (kbm !== 'phone') return;
    kbBox.classList[num ? 'add' : 'remove']('num');
    var e = kbEls[12]; e.firstChild.textContent = num ? 'abc' : '123'; e.lastChild.textContent = t(num ? 'kp.letters' : 'kp.numbers');
  }
  var kbLab = [];
  function paintPend() {
    kbLab.forEach(function (spans, i) {
      for (var j = 0; j < spans.length; j++) spans[j].classList.remove('on');
      if (pend && KP[i][2] == null && KP[i][0] === pend.key) {
        var lab = kpLetters(pend.key);
        var li = lab.indexOf(pend.ch);
        if (li >= 0 && spans[li]) spans[li].classList.add('on');
      }
    });
  }
  function flash(d) {
    var i = -1;
    if (kbm === 'grid') { for (var j = 0; j < kbKeys.length; j++) if (kbKeys[j].ch === d) i = j; }
    else i = d === '0' ? 10 : +d - 1;
    var e = kbEls[i]; if (!e) return;
    e.classList.add('hit'); setTimeout(function () { e.classList.remove('hit'); }, 220);
  }
  function goRight() { // from keyboard to results / chips
    if (hasResults) { zone = 'r'; grid.setRow(0); }
    else if (chipEls.length && !chipsWrap.classList.contains('hid')) { zone = 'c'; ci = 0; }
  }
  /* [client] on-screen keyboard shown / hidden, results grid re-laid out next to it */
  function makeResGrid() {
    var left = native ? gx() : 636, w = native ? RW - left - 4 : 1170;
    haveCols = native ? gcols() : 6;
    return makeGrid($root, { cols: haveCols, sx: 180, sy: 300, cw: 150, ch: 225, left: left, top: 180, width: w, height: 900,
      onOpen: function (it) { remember(); push('detail', { type: it.type, id: it.id, item: it }); } });
  }
  function paintKbLayout() {
    kbBox.classList[kbOn ? 'remove' : 'add']('hid'); legend.classList[kbOn ? 'remove' : 'add']('hid');
    kbBtn.classList[kbOn ? 'add' : 'remove']('on');
    var lx = (gx() + 34) + 'px';
    info.style.left = lx; capEl.style.left = lx;
    chipEls.forEach(function (c) { c.style.left = lx; });
    if (!kbOn && zone === 'k') zone = 'f';
  }
  function applyKb() {
    kbOn = wantKb(); paintKbLayout();
    var old = grid; grid = makeResGrid(); old.remove(); grid.set(results);
    mark();
  }
  function kbPos(i) { // on-screen key index -> kr / kc
    if (kbm === 'grid') { if (i < 36) { kr = Math.floor(i / 6); kc = i % 6; } else { kr = 6; kc = GK_BOT[i - 36][0]; } }
    else if (i < 12) { kr = Math.floor(i / 3); kc = i % 3; } else { kr = 4; kc = i - 12; }
  }
  function submit() { // Enter in the field: search now, then into the results
    commitPend(); clearTimeout(timer); lastQ = null; doSearch(); remember();
    if (hasResults) { goRight(); mark(); } else wantEnter = true;
  }
  function typingKey(k) { // a key the real <input> hands over (Enter / Esc / Up / Down)
    if (k === 'back') { pop(); return true; }
    if (k === 'enter' && zone === 'f') { submit(); if (zone !== 'f') inp.blur(); return true; }
    if (k === 'up' && zone === 'f') return false;
    var z = zone;
    scr.key(k);
    if (z === 'f' && zone !== 'f') inp.blur();
    return true;
  }
  function buildKb() {
    kbBox.textContent = ''; kbEls = []; kbKeys = []; kbLab = [];
    kbBox.className = 'kb' + (kbm === 'grid' ? ' gk' : '');
    legend.innerHTML = t(kbm === 'grid' ? 'search.legendGrid' : 'search.legend');
    if (kbm === 'grid') {
      var add = function (r, c, span, glyph, cls, key) {
        var e = h('div', 'kk' + (cls ? ' ' + cls : ''), glyph);
        e.style.left = (c * GK_PITCH) + 'px'; e.style.top = (r * GK_PITCH) + 'px';
        e.style.width = (span * GK_PITCH - 6) + 'px';
        kbBox.appendChild(e); kbEls.push(e); kbKeys.push(key);
      };
      GK_ROWS.forEach(function (row, r) { row.split('').forEach(function (ch, c) { add(r, c, 1, ch, /\d/.test(ch) ? 'dg' : '', { ch: ch }); }); });
      GK_BOT.forEach(function (b) {
        var role = b[2];
        add(6, b[0], b[1], role === 'del' ? '⌫' : role === 'sp' ? t('kp.space') : role === 'clr' ? t('kp.clear') : t('kp.phone'), 's ' + role, { role: role });
      });
      return;
    }
    KP.forEach(function (k, i) {
      var wide = i >= 12;
      var e = h('div', 'kk' + (wide ? ' km' : ''));
      e.style.left = (wide ? (i - 12) * 276 : (i % 3) * 184) + 'px'; e.style.top = (Math.floor(Math.min(i, 12) / 3) * 136) + 'px';
      e.appendChild(h('div', 'kd' + (k[2] ? ' s' : ''), k[2] === 'clr' ? t(k[0]) : k[0]));
      var lab = h('div', 'kl'), spans = [];
      if (k[2]) lab.textContent = k[1] ? t(k[1]) : '';
      else if (k[0] === '0') lab.textContent = t(k[1]);
      else kpLetters(k[0]).split('').forEach(function (ch) { var sp = h('span', '', ch); lab.appendChild(sp); spans.push(sp); });
      e.appendChild(lab); kbBox.appendChild(e); kbEls.push(e); kbLab.push(spans);
    });
    paintMode();
  }
  function switchKb(to) { // runtime switch, remembered on this TV; focus lands on the switch key of the new mode
    commitPend();
    kbm = to; store.set('kbmode', to);
    if (to === 'grid') { kr = 6; kc = GK_BOT[3][0]; } else { kr = 4; kc = 1; }
    buildKb(); renderField();
  }
  function kbNav(k) {
    if (kbm === 'grid') {
      var bi = gkBot(kc);
      if (k === 'up') { if (kr === 0) zone = 'f'; else kr--; }
      else if (k === 'down') { if (kr < 5) kr++; else if (kr === 5) { kr = 6; kc = GK_BOT[gkBot(kc)][0]; } }
      else if (k === 'left') { if (kr < 6) { if (kc > 0) kc--; else focusRail(); } else if (bi > 0) kc = GK_BOT[bi - 1][0]; else focusRail(); }
      else if (k === 'right') { if (kr < 6) { if (kc < 5) kc++; else goRight(); } else if (bi < GK_BOT.length - 1) kc = GK_BOT[bi + 1][0]; else goRight(); }
      return;
    }
    if (k === 'up') { if (kr === 0) zone = 'f'; else { if (kr === 4) kc = kc ? 2 : 0; kr--; } }
    else if (k === 'down') { if (kr < 3) kr++; else if (kr === 3) { kr = 4; kc = kc === 2 ? 1 : 0; } }
    else if (k === 'left') { if (kr < 4 && kc > 0) kc--; else if (kr === 4 && kc === 1) kc = 0; else focusRail(); }
    else if (k === 'right') { if (kr < 4 && kc < 2) kc++; else if (kr === 4 && kc === 0) kc = 1; else goRight(); }
  }
  var api = {
    mount: function () {
      field = h('div', 'sf'); field.appendChild(svg('search', 40));
      if (native) {
        inp = document.createElement('input'); inp.type = 'text'; inp.value = q; inp.placeholder = t('search.ph'); inp.spellcheck = false;
        inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('enterkeyhint', 'search');
        inp.addEventListener('input', function () { pend = null; clearTimeout(pendTimer); q = inp.value; schedule(); showChips(); });
        inp.addEventListener('pointerdown', function () { if (zone !== 'f') { zone = 'f'; mark(); } });
        inp.addEventListener('focus', function () { if (zone !== 'f') { zone = 'f'; mark(); } });
        inp.__sppKey = typingKey;
        kbBtn = h('div', 'kbt', '⌨'); kbBtn.title = t('kp.toggle');
        field.appendChild(inp); field.appendChild(kbBtn);
        kbOn = wantKb();
      } else { textEl = h('span'); field.appendChild(textEl); }
      $root.appendChild(field);
      if (!native) {
        ime = document.createElement('input'); ime.type = 'text'; ime.style.cssText = 'position:absolute;left:100px;top:60px;width:300px;height:40px;opacity:0';
        $root.appendChild(ime);
        ime.addEventListener('blur', function () { if (editInput === ime) endEdit(false); });
      }
      legend = h('div', 'legend'); $root.appendChild(legend);
      kbBox = h('div', 'kb'); $root.appendChild(kbBox);
      if (M.kbm !== kbm || kr < 0 || kc < 0 || (kbm === 'phone' ? kr > 4 || kc > 2 || (kr === 4 && kc > 1) : kr > 6 || kc > 5)) { kr = 0; kc = 0; }
      if (kbm === 'grid' && kr === 6) kc = GK_BOT[gkBot(kc)][0];
      buildKb();
      capEl = h('div', 'rcap'); $root.appendChild(capEl);
      chipsWrap = h('div', 'hid'); $root.appendChild(chipsWrap);
      info = h('div', 'ab sec', ''); info.style.cssText = 'left:670px;top:200px'; $root.appendChild(info);
      grid = makeResGrid();
      showChips();
      if (zone === 'c' && !chipEls.length) zone = 'f';
      if (zone === 'r') zone = 'f';
      if (native) {
        paintKbLayout();
        kbBox.addEventListener('mousedown', function (e) { e.preventDefault(); }); // clicking a key keeps the typing focus in the field
        chipsWrap.addEventListener('mousedown', function (e) { e.preventDefault(); });
      }
      mark();
      if (eff().length >= 2) doSearch();
    },
    unmount: function () {
      dead = true; clearTimeout(timer); clearTimeout(pendTimer); commitPend();
      M.zone = zone === 'r' ? 'k' : zone; M.kr = kr; M.kc = kc; M.q = q; M.kbm = kbm; grid.destroy();
    },
    key: function (k, e) {
      if (/^n\d$/.test(k)) { flash(k.charAt(1)); if (num || kbm === 'grid') typeChar(k.charAt(1)); else multitap(k.charAt(1)); return; }
      if (k === 'red' || k === 'minus') { backspace(); return; }
      if (k === 'green') { typeChar(' '); return; }
      if (k === 'yellow') { setQ(''); return; }
      if (zone === 'k' && k === 'enter') { pressKey(kbIndex(kr, kc)); mark(); return; }
      commitPend();
      if (k === 'back') { pop(); return; }
      if (zone === 'f') {
        if (k === 'enter' && native) { inp.focus(); return; }
        if (k === 'enter') { ime.value = q; startEdit(ime, function (commit) { if (commit) { q = ime.value; pend = null; renderField(); showChips(); clearTimeout(timer); doSearch(); remember(); } }); return; }
        if (k === 'down') { if (native && !kbOn) goRight(); else zone = 'k'; } else if (k === 'left') focusRail();
        else if (k === 'right') goRight();
      } else if (zone === 'k') {
        kbNav(k);
      } else if (zone === 'c') {
        if (k === 'up') { if (ci > 0) ci--; else zone = 'f'; }
        else if (k === 'down') ci = Math.min(chipEls.length - 1, ci + 1);
        else if (k === 'left') { if (native && !kbOn) focusRail(); else zone = 'k'; }
        else if (k === 'enter') { setQ(chipEls[ci].textContent); lastQ = null; clearTimeout(timer); doSearch(); zone = native && !kbOn ? 'f' : 'k'; }
      } else {
        var r = grid.key(k);
        if (r === 'left') { if (native && !kbOn) focusRail(); else zone = 'k'; } else if (r === 'up') zone = 'f';
      }
      mark();
    },
    other: function (e) { // [client] a letter while the field is not focused (after clicking a key / result): it goes into the field
      if (native && e.isTrusted && !e.ctrlKey && !e.altKey && !e.metaKey && e.key && e.key.length === 1 && document.activeElement !== inp) { zone = 'f'; inp.focus(); mark(); }
    },
    modality: function () { if (native && M.kbPin == null && wantKb() !== kbOn) applyKb(); },
    stale: function () { return native && gcols() !== haveCols; },
    point: function (type, el, d) { // [client]
      if (type === 'wheel') { if (d.dy) grid.scroll(d.dy); return true; }
      if (up(el, 'kbt')) { if (type === 'click') { M.kbPin = !kbOn; applyKb(); } return true; }
      var ke = kbOn ? up(el, 'kk') : null, ce = up(el, 'rchip'), gi = grid.hit(el);
      if (ke && kbEls.indexOf(ke) >= 0) {
        var ki = kbEls.indexOf(ke);
        zone = 'k'; kbPos(ki);
        if (type === 'click') pressKey(ki);
        mark(); return true;
      }
      if (ce && chipEls.indexOf(ce) >= 0) {
        zone = 'c'; ci = chipEls.indexOf(ce);
        if (type === 'click') { setQ(chipEls[ci].textContent); lastQ = null; clearTimeout(timer); doSearch(); zone = 'f'; }
        mark(); return true;
      }
      if (gi >= 0) {
        zone = 'r'; grid.setIdx(gi); mark();
        if (type === 'click') grid.key('enter');
        return true;
      }
      if (up(el, 'sf') && type === 'click') { zone = 'f'; inp.focus(); mark(); return true; }
      return false;
    }
  };
  scr = api;
  return api;
};

/* =====================================================================
   DETAIL (Stremio meta details: left info + right episodes/streams panel)
   ===================================================================== */
Screens.detail = function (p) {
  var key = 'd:' + p.type + ':' + p.id;
  var meta = null, err = null, zone = 'btn', bi = 0, ti = 0, ei = 0, epOff = 0, season = null, seasons = [], mode = 'ep';
  var dead = false, epNodes = {}, epStrip = null, btnEls = [], markEl = null, rate = null, longT = 0, longDone = false;
  var vids = [], left = null, panel = null, sl = null, seasonEl = null, stTarget = null, bgBox = null, bgSrc = '';

  function isSeries() { return !!(meta && meta.type === 'series' && meta.videos && meta.videos.length); }
  function target() {
    if (!meta) return null;
    if (!isSeries()) return { videoId: meta.id, label: '', startSec: meta.resume ? meta.resume.positionSec || 0 : 0 };
    if (meta.resume) return { videoId: meta.resume.videoId, label: meta.resume.label || '', startSec: meta.resume.positionSec || 0 };
    var vs = meta.videos.filter(function (v) { return v.season > 0; });
    if (!vs.length) vs = meta.videos;
    var first = null;
    for (var i = 0; i < vs.length; i++) if (!vs[i].watched) { first = vs[i]; break; }
    first = first || vs[0];
    return { videoId: first.id, label: epLabel(first.season, first.episode), startSec: 0 };
  }
  function seasonVids(s) {
    var l = (meta.videos || []).filter(function (v) { return v.season === s; });
    l.sort(function (a, b) { return a.episode - b.episode; });
    return l;
  }
  function setupSeason(s) {
    season = s; vids = seasonVids(s); ei = 0;
    var t = meta.resume && meta.resume.videoId;
    for (var i = 0; i < vids.length; i++) {
      if (t ? vids[i].id === t : !vids[i].watched) { ei = i; break; }
    }
    epOff = clamp(ei - 2, 0, Math.max(0, vids.length - 7));
  }
  function initSeasons() {
    seasons = meta.seasons && meta.seasons.length ? meta.seasons.slice() : [];
    if (!seasons.length) meta.videos.forEach(function (v) { if (seasons.indexOf(v.season) < 0) seasons.push(v.season); });
    seasons.sort(function (a, b) { return (a || 99) - (b || 99); });
    var s;
    if (meta.resume) {
      var rv = meta.videos.filter(function (v) { return v.id === meta.resume.videoId; })[0];
      if (rv) s = rv.season;
    }
    if (s == null) {
      s = seasons.filter(function (x) { return x > 0; })[0];
      if (s == null) s = seasons[0];
      for (var i = 0; i < seasons.length; i++) {
        if (seasons[i] > 0 && seasonVids(seasons[i]).some(function (v) { return !v.watched; })) { s = seasons[i]; break; }
      }
    }
    ti = Math.max(0, seasons.indexOf(s));
    setupSeason(s);
  }
  function watchedLabel() { return currentWatched() ? t('detail.unmark') : t('detail.mark'); }
  function currentWatched() {
    if (!meta) return false;
    if (isSeries()) { var v = vids[ei]; return !!(v && v.watched); }
    return !!meta.watched;
  }
  function seasonName(s) { return s === 0 ? t('detail.specials') : t('detail.season', s); }

  /* ----- left column ----- */
  function drawLeft() {
    release(left); left.textContent = ''; btnEls = [];
    var it = p.item || {};
    if (err) {
      var m = msgBox(left, t('common.couldNotLoad', err), false, t('common.retry')); m.el.style.right = '640px';
      btnEls = [m.btn]; return;
    }
    if (!meta) {
      left.appendChild(h('div', 'dtitle ell', it.name || ''));
      var m2 = msgBox(left, t('common.loading'), true); m2.el.style.right = '640px'; m2.el.style.top = '560px';
      return;
    }
    var title = h('div', 'dtitle', meta.name || ''); left.appendChild(title);
    if (meta.logo) {
      var lw = h('div', 'dlogo'), li = document.createElement('img');
      li.style.display = 'none';
      li.onload = function () { li.style.display = ''; title.style.display = 'none'; };
      li.onerror = function () { lw.style.display = 'none'; };
      li.src = imgUrl(meta.logo, 560); lw.appendChild(li); left.appendChild(lw);
    }
    var mt = h('div', 'dmeta'), parts = [];
    if (meta.runtime) parts.push(meta.runtime);
    if (meta.year) parts.push(meta.year);
    mt.appendChild(document.createTextNode(parts.join('  ·  ')));
    if (meta.imdbRating) mt.appendChild(h('span', 'imdb', 'IMDb ' + meta.imdbRating));
    left.appendChild(mt);
    var gn = h('div', 'dgen');
    (meta.genres || []).slice(0, 4).forEach(function (g) { gn.appendChild(h('span', 'pill', g)); });
    left.appendChild(gn);
    left.appendChild(h('div', 'ddesc', meta.description || ''));
    var tg = target(), bw = h('div', 'dbtns'), series = isSeries();
    var playLabel = meta.resume ? t('detail.continue', meta.resume.label || '') : t('detail.watch') + (series && tg.label ? ' ' + tg.label : '');
    var defs = [['play', playLabel], [meta.inLibrary ? 'libcheck' : 'lib', t('detail.library')], ['star', t('detail.rate')], ['check', watchedLabel()]];
    defs.forEach(function (d, i) {
      var e = h('div', 'btn' + (i === 1 && meta.inLibrary ? ' on' : ''));
      e.appendChild(svg(d[0], 30)); e.appendChild(document.createTextNode(d[1]));
      bw.appendChild(e); btnEls.push(e);
    });
    left.appendChild(bw);
    var n = meta.userRating ? Math.round(meta.userRating / 2) : 0, sa = '', sb = '';
    for (var i = 0; i < 5; i++) { if (i < n) sa += '★'; else sb += '★'; }
    var sd = h('div', 'dstar'); sd.appendChild(document.createTextNode(n ? t('detail.yourRating') : t('detail.noRating')));
    sd.appendChild(h('b', '', sa)); var s2 = h('span', '', sb); s2.style.cssText = 'color:#38335a;letter-spacing:4px'; sd.appendChild(s2);
    left.appendChild(sd);
    mark();
  }
  function drawBg() {
    var bg = (meta && meta.background) || (p.item && p.item.background) || '';
    var s = imgUrl(bg, 1280);
    if (!s || s === bgSrc) return;
    bgSrc = s; bgBox.textContent = ''; bgBox.appendChild(mkImg(s));
  }

  /* ----- right panel ----- */
  function mkEp(i) {
    var v = vids[i], e = h('div', 'ep');
    e.style.top = (i * 116) + 'px';
    var th = h('div', 'th');
    th.appendChild(h('div', 'phn', 'E' + v.episode));
    if (v.thumbnail) th.appendChild(mkImg(imgUrl(v.thumbnail, 200)));
    if (v.watched) th.appendChild(h('div', 'chk', '✓'));
    else if (v.progress > 0) { var b = h('div', 'pb'), f = h('div', 'pf'); f.style.width = Math.round(Math.min(1, v.progress) * 100) + '%'; b.appendChild(f); th.appendChild(b); }
    e.appendChild(th);
    e.appendChild(h('div', 'et', v.episode + '. ' + (v.title || t('detail.episode', v.episode))));
    if (v.released) { var d = String(v.released).slice(0, 10).split('-'); if (d.length === 3) e.appendChild(h('div', 'ed', t('date.full', d[0], d[1], d[2]))); }
    return e;
  }
  function drawEps() {
    clearNodes(epNodes);
    if (!epStrip) return;
    sync(epNodes, epStrip, Math.max(0, epOff - 2), Math.min(vids.length - 1, epOff + 10), mkEp);
    tx(epStrip, 0, -epOff * 116);
    markPanel();
  }
  function drawSeason() {
    if (!seasonEl) return;
    seasonEl.textContent = '';
    var l = svg('left', 34); l.style.left = '24px'; var r = svg('right', 34); r.style.right = '24px';
    seasonEl.appendChild(l); seasonEl.appendChild(document.createTextNode(seasonName(season))); seasonEl.appendChild(r);
  }
  function drawPanel() {
    if (sl) { sl.destroy(); sl = null; }
    clearNodes(epNodes); epNodes = {}; epStrip = null; seasonEl = null;
    release(panel); panel.textContent = '';
    if (!meta) return;
    if (mode === 'st') {
      var hd = h('div', 'ph1');
      if (isSeries()) { hd.appendChild(svg('back', 30)); hd.appendChild(document.createTextNode(stTarget.label + (stTarget.title ? ' · ' + stTarget.title : ''))); }
      else hd.appendChild(document.createTextNode(t('detail.sources')));
      panel.appendChild(hd);
      sl = makeStreamList(panel, { top: 116, height: 960, type: meta.type, videoId: stTarget.videoId, itemId: meta.id, onChoose: chooseStream });
      sl.setActive(zone === 'st');
    } else {
      seasonEl = h('div', 'season'); panel.appendChild(seasonEl); drawSeason();
      var w = h('div', 'plist'); w.style.height = '964px'; epStrip = h('div', 'strip'); w.appendChild(epStrip); panel.appendChild(w);
      drawEps();
    }
    markPanel();
  }
  function markPanel() {
    setF(seasonEl, zone === 'season');
    setF(markEl, false); markEl = null;
    if (zone === 'ep') { markEl = epNodes[ei] || null; setF(markEl, true); }
    if (sl) sl.setActive(zone === 'st');
  }
  function mark() {
    btnEls.forEach(function (e, i) { setF(e, zone === 'btn' && i === bi); });
    markPanel();
  }

  /* ----- actions ----- */
  function load(force) {
    var path = metaPath(p);
    if (force) cache.delete(path);
    err = null; meta = null; drawLeft();
    cget(path, 120000, 12000).then(function (m) { if (!dead) gotMeta(m); }, function (er) { if (dead) return; err = er.message; drawLeft(); });
  }
  function gotMeta(m) {
    meta = m;
    if (isSeries()) { initSeasons(); mode = 'ep'; }
    else { mode = 'st'; stTarget = { videoId: meta.id, label: '', title: '' }; }
    drawBg(); drawLeft(); drawPanel();
  }
  function refresh() { cache.delete(metaPath(p)); }
  function playTarget(tg) {
    startPlayback({ type: meta.type, itemId: meta.id, videoId: tg.videoId, name: meta.name, label: tg.label, startSec: tg.startSec, item: p.item || meta });
  }
  function epTarget(v) {
    var pos = meta.resume && meta.resume.videoId === v.id ? meta.resume.positionSec : 0;
    return { videoId: v.id, label: epLabel(v.season, v.episode), startSec: pos || 0, title: v.title || '' };
  }
  function chooseStream(s) {
    var tg = isSeries() ? stTarget : target();
    var ctx = { type: meta.type, itemId: meta.id, videoId: stTarget.videoId, name: meta.name, label: stTarget.label || tg.label || '', startSec: stTarget.startSec || 0, item: p.item || meta };
    if (!s) ctx.noMem = true;
    else { ctx.sid = s.sid; ctx.sig = sigOf(s); store.set('lastsid:' + ctx.videoId, s.sid); }
    startPlayback(ctx);
  }
  function openStreams(v) {
    var t = epTarget(v); stTarget = t; mode = 'st'; zone = 'st'; drawPanel();
  }
  function actBtn() {
    if (err) { load(true); return; }
    var tg = target();
    switch (bi) {
      case 0: playTarget(tg); break;
      case 1:
        var add = !meta.inLibrary; meta.inLibrary = add; drawLeft();
        post('/api/library', { itemId: meta.id, type: meta.type, add: add }).then(function () { refresh(); cache.delete('/api/library'); }, function () { meta.inLibrary = !add; refresh(); if (!dead) drawLeft(); });
        break;
      case 2: rate = { v: meta.userRating ? Math.round(meta.userRating / 2) : 0 }; drawRate(); break;
      case 3: toggleWatched(); break;
    }
  }
  function toggleWatched() {
    var series = isSeries(), v = series ? vids[ei] : null;
    if (series && !v) return;
    var nw = !currentWatched();
    if (series) { v.watched = nw; if (nw) v.progress = 0; } else meta.watched = nw;
    var body = { itemId: meta.id, watched: nw };
    if (series) body.videoId = v.id;
    drawLeft(); if (series && mode === 'ep') drawEps();
    post('/api/watched', body).then(refresh, function () { if (series) v.watched = !nw; else meta.watched = !nw; refresh(); if (!dead) { drawLeft(); if (series && mode === 'ep') drawEps(); } });
  }
  function drawRate() {
    $modal.textContent = '';
    var box = h('div', 'box'); box.appendChild(h('div', 't', t('rate.title')));
    var s = h('div', 'stars'), a = '', b = '';
    for (var i = 0; i < 5; i++) { if (i < rate.v) a += '★'; else b += '★'; }
    if (RESP) { // [client] each star is clickable: click sets it and saves (click the current one again to clear)
      for (var si = 0; si < 5; si++) {
        var sp = h('span', si < rate.v ? 'on' : '', '★');
        sp.addEventListener('click', (function (n) { return function () { rate.v = n === rate.v ? 0 : n; rateKey('enter'); }; })(si + 1));
        s.appendChild(sp);
      }
      box.appendChild(s);
    } else { s.appendChild(h('b', '', a)); s.appendChild(document.createTextNode(b)); box.appendChild(s); }
    box.appendChild(h('div', 'sec sm', rate.v ? t('rate.hint', rate.v) : t('rate.none')));
    var r1 = r100Target();
    var r1el = h('div', 'sec sm r1', r1.movie ? t('rate.r100movie') : t('rate.r100ep', r1.label));
    if (RESP) { r1el.className += ' lnk'; r1el.addEventListener('click', function () { rate = null; closeModal(); openR100(); }); }
    box.appendChild(r1el);
    $modal.appendChild(box); $modal.className = 'rt';
  }
  // what the 0-100 rating from Detail applies to: the movie, or the episode focused in the list (else the next/resumed one)
  function r100Target() {
    if (!isSeries()) return { videoId: meta.id, label: '', movie: true };
    var v = mode === 'ep' && vids[ei] ? vids[ei] : null; // the episode last focused in the list
    if (v) return { videoId: v.id, label: epLabel(v.season, v.episode), movie: false };
    var tg = target(); return { videoId: tg.videoId, label: tg.label || '', movie: false };
  }
  function openR100() {
    var r1 = r100Target();
    openRate100({ itemId: meta.id, videoId: r1.videoId, type: meta.type, name: meta.name, label: r1.label, movie: r1.movie });
  }
  function rateKey(k) {
    if (k === 'left') rate.v = Math.max(0, rate.v - 1);
    else if (k === 'right') rate.v = Math.min(5, rate.v + 1);
    else if (k === 'back') { rate = null; $modal.classList.add('hid'); return; }
    else if (k === 'down') { rate = null; closeModal(); openR100(); return; }
    else if (k === 'enter') {
      var val = rate.v ? rate.v * 2 : null; rate = null; $modal.classList.add('hid');
      meta.userRating = val; drawLeft();
      post('/api/rate', { itemId: meta.id, type: meta.type, rating: val }).then(refresh, NOOP);
      return;
    }
    drawRate();
  }
  function changeSeason(n) {
    ti = n; setupSeason(seasons[ti]); drawSeason(); drawEps();
    if (btnEls[3]) btnEls[3].lastChild.textContent = watchedLabel();
  }
  return {
    mount: function () {
      bgBox = h('div', 'dbg'); $root.appendChild(bgBox); $root.appendChild(h('div', 'dov'));
      left = h('div'); $root.appendChild(left);
      panel = h('div', 'pnl'); $root.appendChild(panel);
      var c = cache.get(metaPath(p));
      if (c && Date.now() - c.t < 120000) {
        var mm = nav.memo[key];
        meta = c.v;
        if (isSeries()) {
          initSeasons(); mode = 'ep';
          if (mm && mm.season != null && seasons.indexOf(mm.season) >= 0) {
            ti = seasons.indexOf(mm.season); season = mm.season; vids = seasonVids(season);
            ei = clamp(mm.ei, 0, Math.max(0, vids.length - 1)); epOff = clamp(mm.epOff, 0, Math.max(0, vids.length - 1));
          }
        } else { mode = 'st'; stTarget = { videoId: meta.id, label: '', title: '' }; }
        if (mm) { zone = mm.zone === 'st' && isSeries() ? 'ep' : mm.zone; bi = mm.bi; }
        drawBg(); drawLeft(); drawPanel();
      } else {
        if (p.item) bgSrc = '';
        drawBg(); load(false);
      }
    },
    unmount: function () {
      dead = true; clearTimeout(longT);
      nav.memo[key] = { zone: zone, bi: bi, ei: ei, epOff: epOff, season: season };
      clearNodes(epNodes); if (sl) sl.destroy();
    },
    key: function (k, e) {
      if (rate) { rateKey(k); return; }
      if (err || !meta) { if (k === 'enter') actBtn(); else if (k === 'back') pop(); else if (k === 'left') focusRail(); return; }
      if (zone === 'btn') {
        if (k === 'back') { pop(); return; }
        if (k === 'left') { if (bi > 0) bi--; else { focusRail(); return; } }
        else if (k === 'right') { if (bi < btnEls.length - 1) bi++; else { zone = isSeries() && mode === 'ep' ? 'ep' : mode === 'st' ? 'st' : zone; if (zone === 'ep' && !vids.length) zone = 'season'; } }
        else if (k === 'enter') { actBtn(); return; }
        else if (k === 'play') { playTarget(target()); return; }
      } else if (zone === 'season') {
        if (k === 'back') { pop(); return; }
        if (k === 'left') { if (ti > 0) changeSeason(ti - 1); else zone = 'btn'; }
        else if (k === 'right') { if (ti < seasons.length - 1) changeSeason(ti + 1); }
        else if (k === 'down' || k === 'enter') { if (vids.length) zone = 'ep'; }
      } else if (zone === 'ep') {
        if (k === 'back') { pop(); return; }
        if (k === 'left') zone = 'btn';
        else if (k === 'up') { if (ei > 0) ei--; else zone = 'season'; }
        else if (k === 'down') ei = Math.min(vids.length - 1, ei + 1);
        else if (k === 'chdn') ei = Math.min(vids.length - 1, ei + 6);
        else if (k === 'chup') ei = Math.max(0, ei - 6);
        else if (k === 'play') { var vv = vids[ei]; if (vv) playTarget(epTarget(vv)); return; }
        else if (k === 'enter') {
          if (e && e.repeat) return;
          longDone = false; clearTimeout(longT);
          longT = setTimeout(function () { longT = 0; longDone = true; var v2 = vids[ei]; if (v2) playTarget(epTarget(v2)); }, 650);
          return;
        }
        if (ei < epOff) epOff = ei; else if (ei > epOff + 6) epOff = ei - 6;
        drawEps();
        if (btnEls[3]) btnEls[3].lastChild.textContent = watchedLabel();
      } else { // streams list
        if (k === 'back') {
          if (isSeries()) { mode = 'ep'; zone = 'ep'; drawPanel(); } else pop();
          return;
        }
        var r = sl.key(k);
        if (r === 'left') zone = 'btn';
      }
      mark();
    },
    keyup: function (k) {
      if (k === 'enter' && zone === 'ep' && longT) {
        clearTimeout(longT); longT = 0;
        if (!longDone) { var v = vids[ei]; if (v) openStreams(v); }
        mark();
      }
    },
    point: function (type, el, d) { // [client] element -> focus index; hover moves the focus, click activates, the wheel scrolls the panel
      if (rate) return false; // the stars box has its own listeners
      if (err || !meta) { if (err && type === 'click' && up(el, 'btn')) actBtn(); return true; }
      if (type === 'wheel') {
        if (inside(el, panel)) {
          if (mode === 'ep') { if (d.dy) { epOff = clamp(epOff + d.dy, 0, Math.max(0, vids.length - 7)); drawEps(); } }
          else if (sl) sl.scroll(d.dy || 0);
        }
        return true;
      }
      var b = btnEls.indexOf(up(el, 'btn'));
      if (b >= 0 && inside(el, left)) { zone = 'btn'; bi = b; mark(); if (type === 'click') actBtn(); return true; }
      if (seasonEl && inside(el, seasonEl)) {
        zone = 'season';
        if (type === 'click') {
          var sr = seasonEl.getBoundingClientRect(), dir = d.x < sr.left + sr.width / 2 ? -1 : 1;
          if (dir < 0 ? ti > 0 : ti < seasons.length - 1) changeSeason(ti + dir);
        }
        mark(); return true;
      }
      var epEl = mode === 'ep' ? up(el, 'ep') : null;
      if (epEl) {
        for (var k in epNodes) if (epNodes[k] === epEl) {
          if (zone !== 'ep' || ei !== +k) { zone = 'ep'; ei = +k; mark(); if (btnEls[3]) btnEls[3].lastChild.textContent = watchedLabel(); }
          if (type === 'click') { var v = vids[ei]; if (v) openStreams(v); }
          return true;
        }
      }
      if (mode === 'st' && sl) {
        if (up(el, 'ph1')) { if (type === 'click' && isSeries()) { mode = 'ep'; zone = 'ep'; drawPanel(); mark(); } return true; }
        if (sl.point(type, el, d)) { if (zone !== 'st') { zone = 'st'; mark(); } return true; }
      }
      return false;
    }
  };
};
Screens.settings = function () {
  var S = { audioLang: 'pt', subLang: 'pt', autoSkip: false, kbMode: srvSet('kbMode', 'grid'), ratingInput: srvSet('ratingInput', 'dpad'), ratePrompt: srvSet('ratePrompt', true) !== false };
  var idx = 0, off = 0, els = [], vEls = [], kEls = [], dead = false, note, srvEdit, prev, h1, strip, hold = false, api = null;
  // [row id, label key]; rows scroll when they do not fit (VIS rows visible)
  var ROWS = [['server', 'set.server'], ['audio', 'set.audio'], ['subs', 'set.subs'], ['skip', 'set.skip'], ['subSize', 'set.subSize'], ['subColor', 'set.subColor'],
    ['subBg', 'set.subBg'], ['subPos', 'set.subPos'], ['kb', 'set.kb'], ['rateIn', 'set.rateIn'], ['ratePrompt', 'set.ratePrompt'], ['appLang', 'set.appLang'], ['about', 'set.about']];
  if (SAVER_UI) ROWS.splice(ROWS.length - 1, 0, ['saver', 'set.saver']); // only outside Tizen (Windows/Android clients)
  var VIS = 10, SUBROWS = { subSize: 'size', subColor: 'color', subBg: 'bg', subPos: 'pos' };
  function id(i) { return ROWS[i][0]; }
  function drawPrev() {
    prev.textContent = ''; prev.style.display = SUBROWS[id(idx)] ? 'block' : 'none';
    var s = h('div', ''); s.id = 'sub'; applySubStyle(s);
    ['fontSize', 'lineHeight', 'bottom'].forEach(function (k) { s.style[k] = Math.round(parseFloat(s.style[k]) * 0.323) + 'px'; }); s.appendChild(h('span', '', t('set.preview'))); prev.appendChild(s);
  }
  function langName(c) { return t('lang.' + c); }
  var ST = subStyle();
  var AL = ['pt', 'en', 'ja'], SL = ['pt', 'en', 'off'], KBM = ['grid', 'phone'], RIN = ['dpad', 'digits'];
  var SUBLISTS = { size: SUB_SIZES, color: SUB_COLORS, bg: SUB_BGS, pos: SUB_POS };
  function val(i) {
    var r = id(i);
    if (r === 'server') return BASE || t('set.notConnected');
    if (r === 'audio') return I18N.en['lang.' + S.audioLang] ? langName(S.audioLang) : S.audioLang;
    if (r === 'subs') return I18N.en['lang.' + S.subLang] ? langName(S.subLang) : S.subLang;
    if (r === 'skip') return S.autoSkip ? t('val.on') : t('val.off');
    if (SUBROWS[r]) { var k = SUBROWS[r]; return t(SUBLISTS[k][ST[k]][0]); }
    if (r === 'kb') return t(S.kbMode === 'phone' ? 'kb.phone' : 'kb.grid');
    if (r === 'rateIn') return t(S.ratingInput === 'digits' ? 'ri.digits' : 'ri.dpad');
    if (r === 'ratePrompt') return S.ratePrompt ? t('val.on') : t('val.off');
    if (r === 'appLang') return LANG_OWN[LANG]; // each language is named in itself
    if (r === 'saver') return saverOn() ? t('val.on') : t('val.off');
    return 'v' + VERSION;
  }
  function refresh(noScroll) {
    if (noScroll || hold) { /* [client] the pointer picked this row: keep the list where it is */ }
    else if (idx > off + VIS - 2) off = Math.min(ROWS.length - VIS, idx - VIS + 2); else if (idx < off + 1) off = Math.max(0, idx - 1);
    tx(strip, 0, -off * 80);
    vEls.forEach(function (e, i) { e.textContent = val(i); }); els.forEach(function (e, i) { setF(e, i === idx); });
  }
  function save() {
    srvKeep({ kbMode: S.kbMode, ratingInput: S.ratingInput, ratePrompt: S.ratePrompt });
    post('/api/settings', { audioLang: S.audioLang, subLang: S.subLang, autoSkip: S.autoSkip, kbMode: S.kbMode, ratingInput: S.ratingInput, ratePrompt: S.ratePrompt }).then(function () { cache.delete('/api/settings'); }, function (er) { note.textContent = t('set.saveFail', er.message); });
  }
  function cyc(list, v, dir) { var i = list.indexOf(v); return list[((i < 0 ? 0 : i) + dir + list.length) % list.length]; }
  function drawNote() { note.textContent = t('set.note', BASE || t('set.hostEx')); }
  function relabel() { // after the app language changed: texts only, focus stays where it is
    h1.textContent = t('set.title');
    kEls.forEach(function (e, i) { e.textContent = t(ROWS[i][1]); });
    drawNote(); drawPrev();
  }
  api = {
    mount: function () {
      h1 = h('div', 'h1', t('set.title')); $root.appendChild(h1);
      var w = h('div', 'setwrap'); strip = h('div', 'ab'); strip.style.cssText = 'left:0;top:0;width:1100px'; w.appendChild(strip);
      ROWS.forEach(function (l, i) {
        var r = h('div', 'srow'); r.style.top = (i * 80) + 'px';
        var kk = h('div', 'k', t(l[1])); r.appendChild(kk); var v = h('div', 'v ell', ''); r.appendChild(v);
        strip.appendChild(r); els.push(r); vEls.push(v); kEls.push(kk);
      });
      srvEdit = document.createElement('input'); srvEdit.type = 'text';
      srvEdit.style.cssText = 'position:absolute;right:20px;top:8px;width:640px;height:56px;background:#0f0d1a;border:2px solid #7b5cff;border-radius:28px;color:#fff;font-size:28px;padding:0 24px;display:none;font-family:inherit';
      els[0].appendChild(srvEdit);
      srvEdit.addEventListener('blur', function () { if (editInput === srvEdit) endEdit(false); });
      $root.appendChild(w);
      prev = h('div', ''); prev.id = 'subprev'; $root.appendChild(prev); drawPrev();
      note = h('div', 'note', ''); drawNote();
      $root.appendChild(note);
      refresh();
      cget('/api/settings', 30000, 6000).then(function (s) {
        if (dead) return;
        if (s) {
          S.audioLang = s.audioLang || 'pt'; S.subLang = s.subLang || 'pt'; S.autoSkip = !!s.autoSkip;
          srvKeep(s);
          S.kbMode = srvSet('kbMode', 'grid'); S.ratingInput = srvSet('ratingInput', 'dpad'); S.ratePrompt = srvSet('ratePrompt', true) !== false;
        }
        refresh();
      }, function (er) { if (!dead) note.textContent = t('set.readFail', er.message); });
    },
    unmount: function () { dead = true; },
    key: function (k) {
      var r = id(idx);
      if (k === 'back') { pop(); return; }
      if (k === 'left' && (r === 'server' || r === 'about')) { focusRail(); return; }
      if (k === 'up') idx = Math.max(0, idx - 1);
      else if (k === 'down') idx = Math.min(els.length - 1, idx + 1);
      else if (k === 'enter' || k === 'left' || k === 'right') {
        var dir = k === 'left' ? -1 : 1;
        if (r === 'server' && k === 'enter') {
          srvEdit.style.display = 'block'; srvEdit.value = BASE; vEls[0].style.display = 'none';
          startEdit(srvEdit, function (commit) {
            srvEdit.style.display = 'none'; vEls[0].style.display = '';
            var v = srvEdit.value.trim();
            if (commit && v && v !== BASE) {
              if (!/^https?:\/\//.test(v)) v = 'http://' + v;
              note.textContent = t('connect.testing', v);
              probe(v).then(function (ok) {
                if (dead) return;
                if (ok) adopt(v); else note.textContent = t('set.noReply', v, BASE);
              });
            }
          });
        } else if (r === 'audio') { S.audioLang = cyc(AL, S.audioLang, dir); save(); }
        else if (r === 'subs') { S.subLang = cyc(SL, S.subLang, dir); save(); }
        else if (r === 'skip') { S.autoSkip = !S.autoSkip; save(); }
        else if (r === 'kb') { S.kbMode = cyc(KBM, S.kbMode, dir); store.set('kbmode', null); save(); } // the setting replaces the runtime switch
        else if (r === 'rateIn') { S.ratingInput = cyc(RIN, S.ratingInput, dir); save(); }
        else if (r === 'ratePrompt') { S.ratePrompt = !S.ratePrompt; save(); }
        else if (r === 'saver') { store.set('saver', !saverOn()); }
        else if (r === 'appLang') { setLang(LANGS[(LANGS.indexOf(LANG) + dir + LANGS.length) % LANGS.length]); relabel(); }
        else if (SUBROWS[r]) {
          var key = SUBROWS[r], n = SUBLISTS[key].length;
          ST[key] = (ST[key] + dir + n) % n; store.set('substyle', ST);
        }
      }
      refresh(); drawPrev();
    },
    point: function (type, el, d) { // [client]
      if (type === 'wheel') { if (d.dy) { off = clamp(off + d.dy, 0, Math.max(0, ROWS.length - VIS)); refresh(true); } return true; }
      if (el === srvEdit) return false;
      var i = els.indexOf(up(el, 'srow'));
      if (i < 0) return false;
      if (type === 'move') { if (idx !== i) { idx = i; refresh(true); drawPrev(); } }
      else if (type === 'click') { idx = i; hold = true; api.key('enter'); hold = false; }
      return true;
    }
  };
  return api;
};

/* ---------- subtitle style ---------- */
var SUB_SIZES = [['sz.small', 40], ['sz.medium', 50], ['sz.large', 60], ['sz.huge', 72]]; // [label key, value]
var SUB_COLORS = [['col.white', '#ffffff'], ['col.yellow', '#ffe14d']];
var SUB_BGS = [['bg.box', 'box'], ['bg.outline', 'outline'], ['bg.solid', 'solid']];
var SUB_POS = [['pos.bottom', 64], ['pos.higher', 150]];
function subStyle() {
  var d = { size: 1, color: 0, bg: 0, pos: 0 }, s = store.get('substyle', null) || {};
  Object.keys(d).forEach(function (k) { if (typeof s[k] === 'number') d[k] = s[k]; });
  return d;
}
function applySubStyle(el) {
  var st = subStyle(), size = SUB_SIZES[st.size][1];
  el.className = 'sb-' + SUB_BGS[st.bg][1];
  el.style.fontSize = size + 'px'; el.style.lineHeight = Math.round(size * 1.32) + 'px';
  el.style.color = SUB_COLORS[st.color][1]; el.style.bottom = SUB_POS[st.pos][1] + 'px';
}

function makeMockAV() {
  var state = 'NONE', t = 0, dur = 0, lis = null, timer = 0;
  function speed() { return window.__mockSpeed || 1; }
  function tick() {
    t += 250 * speed();
    if (dur && t >= dur * 1000) {
      t = dur * 1000; clearInterval(timer); timer = 0; state = 'PAUSED';
      if (lis && lis.onstreamcompleted) lis.onstreamcompleted();
      return;
    }
    if (lis && lis.oncurrentplaytime) lis.oncurrentplaytime(t);
  }
  return {
    isMock: true,
    open: function () { state = 'IDLE'; t = 0; },
    close: function () { clearInterval(timer); timer = 0; state = 'NONE'; lis = null; },
    setDisplayRect: NOOP, setDisplayMethod: NOOP,
    setListener: function (l) { lis = l; },
    prepareAsync: function (ok) { state = 'READY'; if (lis && lis.onbufferingstart) lis.onbufferingstart(); setTimeout(function () { if (lis && lis.onbufferingcomplete) lis.onbufferingcomplete(); ok(); }, 250); },
    seekTo: function (ms, ok) {
      if (lis && lis.onbufferingstart) lis.onbufferingstart();
      setTimeout(function () { t = ms; if (lis && lis.onbufferingcomplete) lis.onbufferingcomplete(); if (lis && lis.oncurrentplaytime) lis.oncurrentplaytime(t); ok(); }, 200);
    },
    play: function () { state = 'PLAYING'; if (!timer) timer = setInterval(tick, 250); },
    pause: function () { state = 'PAUSED'; clearInterval(timer); timer = 0; },
    stop: function () { clearInterval(timer); timer = 0; state = 'IDLE'; },
    getCurrentTime: function () { return t; },
    getDuration: function () { return dur; },
    getState: function () { return state; },
    _dur: function (s) { dur = s; }
  };
}
var AVREAL = !!(window.webapis && window.webapis.avplay);
// ?mockav=1 forces the simulated player (UI tests in a browser without a real stream)
var AVFORCEMOCK = /[?&]mockav=1/.test(location.search);
var AV = AVREAL ? window.webapis.avplay : (window.AVHTML5 && !AVFORCEMOCK ? window.AVHTML5 : makeMockAV());
var AVMOCK = !AVREAL && (!window.AVHTML5 || AVFORCEMOCK);
/* Data saver (non-Tizen clients only): a per-device choice kept in localStorage; default comes from the client shell. */
var SAVER_UI = !AVREAL && !!(window.AVHTML5 && window.AVHTML5.codecs);
function saverOn() { var v = store.get('saver', null); return v == null ? !!(window.SPP_CLIENT && window.SPP_CLIENT.saverDefault) : !!v; }
var avq = Promise.resolve();
/* ALL AVPlay calls go through this single promise chain */
function enqueue(fn) { var p = avq.then(fn); avq = p.then(NOOP, NOOP); return p; }
function avAsync(name, a, timeout) {
  return new Promise(function (res, rej) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; rej(new Error(t('err.prepTimeout'))); } }, timeout || 15000);
    function ok() { if (!done) { done = true; clearTimeout(to); res(); } }
    function fail(e) { if (!done) { done = true; clearTimeout(to); rej(new Error(t('err.player') + (e ? ' (' + (e.message || e.name || e) + ')' : ''))); } }
    try { if (a == null) AV[name](ok, fail); else AV[name](a, ok, fail); } catch (e) { fail(e); }
  });
}
function readMemMiB() {
  try {
    if (window.tizen && tizen.systeminfo && tizen.systeminfo.getAvailableMemory) {
      var v = tizen.systeminfo.getAvailableMemory();
      if (typeof v === 'number') return v > 5000 ? v / 1048576 : v;
    }
  } catch (e) {}
  if (typeof window.__availMem === 'number') return window.__availMem;
  return null;
}

Screens.player = function (ctx) {
  var P = {
    session: null, duration: 0, audio: [], audioIdx: 0, subs: [], skip: [], next: null,
    sid: ctx.sid || null, sidMem: false, pos: ctx.startSec || 0, state: 'loading',
    subId: null, subOff: 0, cues: [], cueKeys: {}, skipped: {}, nextShown: false, nextDismissed: false,
    settings: {}, panel: null, ctl: -1, err: null, low: false, stopped: false, seek: null, curSkip: null, subDone: false
  };
  var gen = 0, dead = false, E = {};
  var osdTimer = 0, progTimer = 0, memTimer = 0, subTimer = 0, nxTimer = 0, seekTimer = 0, toastTimer = 0;
  var curCue = '', nxCount = 0, errIdx = 0;

  function show(el, on) { if (on) el.classList.remove('hid'); else el.classList.add('hid'); }
  function setSpin(on) { show(E.spin, on); }
  function toast(msg) {
    E.toast.firstChild.textContent = msg; show(E.toast, true);
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { show(E.toast, false); }, 2500);
  }

  function layoutCtl() { // [client] controls anchored to the right edge of the stage; bigger and further apart for touch
    var touch = inputMode() === 'touch', size = touch ? 104 : 76, pitch = touch ? 124 : 84, n = E.ctls.length - 1;
    E.ctls.forEach(function (c, i) { c.style.left = (i === 0 ? 100 : SW - 96 - size - (n - i) * pitch) + 'px'; });
  }
  function barW() { return RESP ? E.bar.offsetWidth || 1720 : 1720; }
  function ctlBtn(left, icon) {
    var c = h('div', 'ctl'); c.style.left = left + 'px'; c.appendChild(svg(icon, 40)); return c;
  }
  function build() {
    $root.className = 'pl' + (AVMOCK ? ' mock' : '');
    document.documentElement.classList.add('playing');
    if (AVMOCK) {
      var m = h('div', 'ab', t('pl.mock'));
      m.style.cssText = 'left:0;top:480px;width:' + SW + 'px;text-align:center;color:#3c4a5c;font-size:30px'; $root.appendChild(m);
    }
    E.sub = h('div'); E.sub.id = 'sub'; applySubStyle(E.sub); $root.appendChild(E.sub);
    E.osd = h('div', 'hid'); E.osd.id = 'osd';
    E.osd.appendChild(h('div', 'otop')); E.osd.appendChild(h('div', 'obot'));
    E.ot = h('div', 'ot ell'); E.os = h('div', 'os');
    E.bar = h('div', 'obar'); E.fill = h('div', 'ofill'); E.bar.appendChild(E.fill);
    E.knob = h('div', 'knob'); E.bar.appendChild(E.knob);
    E.tm = h('div', 'otm');
    // Episode switcher only for series (the eps button sits left of subtitles/audio/sources).
    E.ctlNames = ctx.type === 'series' ? ['pause', 'party', 'eps', 'cc', 'audio', 'src'] : ['pause', 'party', 'cc', 'audio', 'src'];
    if (!window.SPP) E.ctlNames.splice(1, 1); // watch-along module not loaded
    var CTL_X = { pause: 100, party: ctx.type === 'series' ? 1412 : 1496, eps: 1496, cc: 1580, audio: 1664, src: 1748 };
    E.ctls = E.ctlNames.map(function (n) { return ctlBtn(CTL_X[n], n); });
    [E.ot, E.os, E.bar, E.tm].concat(E.ctls).forEach(function (e) { E.osd.appendChild(e); });
    if (RESP) { E.bhit = h('div', 'obhit'); E.osd.appendChild(E.bhit); layoutCtl(); } // [client] wide click target over the seek bar
    $root.appendChild(E.osd);
    E.ico = h('div', 'ico hid'); E.ico.appendChild(svg('pause', 110)); $root.appendChild(E.ico);
    E.spin = h('div', 'spinbox'); E.spin.appendChild(h('div', 'spin')); $root.appendChild(E.spin);
    E.skip = h('div', 'skip hid', t('skip.intro')); $root.appendChild(E.skip);
    E.nx = h('div', 'nx hid'); E.nx.appendChild(h('div', 'a', t('next.label'))); E.nxb = h('div', 'b ell'); E.nx.appendChild(E.nxb);
    E.nxc = h('div', 'c'); E.nx.appendChild(E.nxc); E.nx.appendChild(h('div', 'h', t('next.hint'))); $root.appendChild(E.nx);
    E.pnl = h('div', 'ppnl hid'); $root.appendChild(E.pnl);
    E.err = h('div', 'err hid'); E.errt = h('div', 't'); E.err.appendChild(E.errt);
    E.errb = [h('div', 'btn f', t('common.retry')), h('div', 'btn', t('err.other'))];
    E.errb.forEach(function (b) { E.err.appendChild(b); });
    $root.appendChild(E.err);
    E.toast = h('div', 'toast hid'); E.toast.appendChild(h('span')); $root.appendChild(E.toast);
    E.ot.textContent = ctx.name || ''; E.os.textContent = ctx.label || '';
  }

  /* ---- OSD ---- */
  function syncPlayIcon() {
    var want = P.state === 'paused' ? 'play' : 'pause';
    if (E.playIcon !== want) { E.playIcon = want; E.ctls[0].textContent = ''; E.ctls[0].appendChild(svg(want, 40)); }
  }
  function renderBar() {
    var t = P.seek ? P.seek.target : P.pos, d = P.duration;
    var pct = d > 0 ? clamp(t / d, 0, 1) : 0;
    E.fill.style.width = Math.round(pct * 1000) / 10 + '%';
    tx(E.knob, Math.round(pct * barW()), 0);
    E.tm.textContent = '';
    E.tm.appendChild(document.createTextNode(fmtTime(t)));
    E.tm.appendChild(h('span', '', '  /  ' + fmtTime(d)));
  }
  function paintCtl() { E.ctls.forEach(function (c, i) { setF(c, P.ctl === i); }); }
  function showOsd() {
    E.ot.textContent = ctx.name || ''; E.os.textContent = ctx.label || '';
    syncPlayIcon(); renderBar(); show(E.osd, true); E.sub.classList.add('up');
    clearTimeout(osdTimer);
    if (P.state !== 'paused' && !P.panel) osdTimer = setTimeout(hideOsd, 4000);
  }
  function hideOsd() { if (P.panel) return; show(E.osd, false); E.sub.classList.remove('up'); P.ctl = -1; paintCtl(); }
  function osdVisible() { return !E.osd.classList.contains('hid'); }

  /* ---- AVPlay sequence ---- */
  function mkListener(g) {
    return {
      onbufferingstart: function () { if (g === gen) setSpin(true); },
      onbufferingprogress: NOOP,
      onbufferingcomplete: function () { if (g === gen) setSpin(false); },
      oncurrentplaytime: function (ms) { if (g === gen) onTime(ms / 1000); },
      onstreamcompleted: function () { if (g === gen) onEnd(); },
      onevent: NOOP,
      onerror: function (e) { if (g === gen) showError(t('err.playback') + (e ? ' (' + e + ')' : '')); },
      onsubtitlechange: NOOP, ondrmevent: NOOP
    };
  }
  /* close -> open -> setDisplayRect -> setListener -> prepareAsync -> seekTo(start) -> play */
  function openStream(url, startMs, g) {
    return enqueue(function () {
      if (g !== gen || dead) return;
      try { AV.close(); } catch (e) {}
      if (AV._dur) AV._dur(P.duration);
      AV.open(url);
      AV.setDisplayRect(0, 0, 1920, 1080);
      try { AV.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {} // never stretch/zoom
      AV.setListener(mkListener(g));
      return avAsync('prepareAsync', null, 35000).then(function () {
        if (g !== gen || dead) return;
        if (startMs > 0) return avAsync('seekTo', startMs, 20000);
      }).then(function () {
        if (g !== gen || dead) return;
        AV.play();
        try { var d = AV.getDuration(); if (d > 0 && !P.duration) P.duration = d / 1000; } catch (e) {}
      });
    });
  }
  function resolveSid() {
    return cget('/api/streams/' + ctx.type + '/' + encodeURIComponent(ctx.videoId), 60000, 40000).then(function (d) {
      var list = (d && d.streams) || [];
      if (!list.length) throw new Error(t('err.noSources'));
      var pick = null, i;
      if (ctx.sig) for (i = 0; i < list.length; i++) if (sigOf(list[i]) === ctx.sig) { pick = list[i]; break; }
      if (!pick) for (i = 0; i < list.length; i++) if (list[i].recommended) { pick = list[i]; break; }
      pick = pick || list[0];
      P.sid = pick.sid; P.sidMem = false;
    });
  }
  function playBody(startSec, audioIdx) {
    var b = { sid: P.sid, itemId: ctx.itemId, videoId: ctx.videoId, startSec: Math.floor(startSec) };
    if (audioIdx != null) b.audioIdx = audioIdx;
    else { var ap = store.get('audiopref:' + ctx.itemId, null); if (ap && ap.label) b.audioPref = ap.label; }
    if (SAVER_UI) { b.saver = saverOn(); b.codecs = window.AVHTML5.codecs(); }
    if (P.session) b.prevSession = P.session;
    if (P.xdubWant) { b.xdub = true; delete b.audioPref; delete b.audioIdx; }
    return b;
  }
  function begin(startSec, audioIdx) {
    var g = ++gen;
    P.state = 'loading'; P.err = null; show(E.err, false); setSpin(true); show(E.ico, false);
    P.skipped = {}; P.nextShown = false; hideNext(); show(E.skip, false);
    var chain = Promise.resolve();
    if (ctx.needResume) {
      chain = cget(metaPath({ type: ctx.type, id: ctx.itemId }), 60000, 10000).then(function (m) {
        ctx.needResume = false;
        if (m && m.resume) { ctx.videoId = m.resume.videoId; ctx.label = m.resume.label || ctx.label; startSec = m.resume.positionSec || 0; }
        else if (m && m.type === 'movie') ctx.videoId = m.id;
        if (m && m.name) ctx.name = m.name;
        P.pos = startSec;
        E.ot.textContent = ctx.name || ''; E.os.textContent = ctx.label || '';
      }, function () { ctx.needResume = false; });
    }
    chain.then(function () {
      if (g !== gen || dead) return;
      if (!P.sid && !ctx.noMem && !ctx.sig) { var mem = store.get('lastsid:' + ctx.videoId, null); if (mem) { P.sid = mem; P.sidMem = true; } }
      return P.sid ? null : resolveSid();
    }).then(function () {
      if (g !== gen || dead) return;
      return post('/api/play', playBody(startSec, audioIdx), 90000).catch(function (er) {
        if (P.sidMem || er.status === 404 || er.status === 410) {
          P.sid = null; P.sidMem = false;
          return resolveSid().then(function () { return post('/api/play', playBody(startSec, audioIdx), 90000); });
        }
        throw er;
      });
    }).then(function (r) {
      if (!r) return;
      if (g !== gen || dead) { if (r.session) xhr('DELETE', '/api/session/' + r.session, undefined, 4000).catch(NOOP); return; }
      P.session = r.session; P.duration = r.duration || P.duration;
      P.audio = r.audio || []; P.audioIdx = r.audioIdx != null ? r.audioIdx : 0;
      P.subs = r.subs || []; P.skip = r.skip || []; P.next = r.next || null;
      P.hasPtAudio = !!r.hasPtAudio; P.sync = {};
      if (P.xdubWant && !r.xdub) { P.xdubWant = false; toast(t('xd.loadFail')); }
      P.pos = startSec;
      if (P.sid) store.set('lastsid:' + ctx.videoId, P.sid);
      if (!P.subDone) { P.subDone = true; autoSub(); }
      else if (P.subId && !/^emb:/.test(P.subId)) startSync(P.subId, false);
      return openStream(BASE + r.playlist, startSec * 1000, g);
    }).catch(function (er) {
      if (g !== gen || dead) return;
      if (P.xdubWant) { P.xdubWant = false; toast(t('xd.failBack')); begin(startSec, null); return; }
      showError(er.message || t('err.generic'));
    });
  }
  function setCue(txt) {
    E.sub.textContent = '';
    if (txt) { var sp = h('span', '', txt); E.sub.appendChild(sp); }
  }
  // First word of a track label, with the server's per-UI-language names folded together
  // ('Português' = 'Portuguese'), so a remembered choice survives switching the app language.
  var WORD_ALIAS = { 'português': 'portuguese', 'español': 'spanish', 'italiano': 'italian', 'français': 'french', 'deutsch': 'german', 'русский': 'russian', 'embutida': 'embedded' };
  function labelWord(l) { var w = String(l || '').split(/[\s#(·_]/)[0].toLowerCase(); return WORD_ALIAS[w] || w; }
  // Default subtitle: same choice as last time for this title; otherwise, if the audio is not in
  // the user's language, the best track in that language (PT-BR > PT; embedded > external; no forced/signs).
  function autoSub() {
    if (!P.subs.length) return;
    var pref = store.get('subpref:' + ctx.itemId, null);
    if (pref) {
      if (pref.off != null) P.subOff = pref.off;
      if (pref.label === 'off') return;
      for (var j = 0; j < P.subs.length; j++) if (P.subs[j].label === pref.label) { setSub(P.subs[j].id, true); return; }
      var w0 = labelWord(pref.label);
      for (var j2 = 0; j2 < P.subs.length; j2++) {
        var l2 = P.subs[j2].label || '';
        if (w0 && labelWord(l2) === w0 && /OpenSubtitles/.test(l2) === /OpenSubtitles/.test(pref.label)) { setSub(P.subs[j2].id, true); return; }
      }
    }
    var sl = P.settings.subLang;
    if (!sl || sl === 'off') return;
    var aud = (P.audio[P.audioIdx] || {}).label || '';
    var langRe = sl === 'pt' ? /portugu|\bpt\b|pt-br|pob|\bpor\b|brazil|brasil/i : sl === 'en' ? /\ben\b|\beng\b|english|ingl/i : new RegExp(sl, 'i');
    if (langRe.test(aud)) return;
    var best = null, bestScore = -1;
    P.subs.forEach(function (s) {
      var l = s.label || '';
      if (!langRe.test(l)) return;
      if (/forced|for[cç]ad|signs|songs|letreiro/i.test(l)) return;
      var sc = 10;
      if (sl === 'pt' && /brazil|brasil|pt-br|pob|\(br\)|\bbr\b/i.test(l)) sc += 5;
      if (sl === 'pt' && /portugal|european|\bpt-pt\b/i.test(l)) sc -= 3;
      if (/^emb:/.test(s.id)) sc += 3;
      if (/sdh|cc\b|hearing/i.test(l)) sc -= 1;
      if (sc > bestScore) { bestScore = sc; best = s; }
    });
    if (best) setSub(best.id, true);
  }

  /* ---- time-driven logic ---- */
  function onTime(sec) {
    P.pos = sec;
    if (P.state === 'loading') { P.state = 'playing'; setSpin(false); startTimers(); showOsd(); }
    if (!P.seek && osdVisible()) renderBar();
    var txt = '';
    if (P.subId) {
      var tt = sec - P.subOff;
      for (var i = 0; i < P.cues.length; i++) { var c = P.cues[i]; if (tt >= c[0] && tt < c[1]) { txt = c[2]; break; } }
    }
    if (txt !== curCue) { curCue = txt; setCue(txt); }
    checkSkip(sec);
    checkNext(sec);
  }
  function skipName(s) { return t(s.type === 'intro' ? 'skip.intro' : s.type === 'outro' ? 'skip.outro' : 'skip.recap'); }
  function checkSkip(sec) {
    var seg = null, si = -1;
    for (var i = 0; i < P.skip.length; i++) { var s = P.skip[i]; if (sec >= s.start && sec < s.end - 1) { seg = s; si = i; break; } }
    if (!seg) { if (P.curSkip) { P.curSkip = null; show(E.skip, false); } return; }
    P.curSkip = seg;
    if (P.settings.autoSkip && !P.skipped[si] && (seg.type !== 'outro' || P.next)) {
      P.skipped[si] = 1; toast(skipName(seg) + t('skip.auto')); applySeek(seg.end + 0.2); show(E.skip, false); return;
    }
    E.skip.textContent = skipName(seg) + '  (OK)';
    show(E.skip, true);
  }
  function checkNext(sec) {
    if (!P.next || P.nextShown || P.nextDismissed || P.duration <= 0) return;
    var os = null;
    for (var i = 0; i < P.skip.length; i++) if (P.skip[i].type === 'outro') os = P.skip[i];
    var trig = (os && sec >= os.start && os.start > P.duration * 0.5) || sec >= P.duration - 25;
    if (!trig) return;
    P.nextShown = true; nxCount = 10;
    E.nxb.textContent = P.next.label || t('next.default');
    E.nxc.textContent = t('next.count', nxCount);
    show(E.nx, true);
    // rating prompt over the up-next card: OK saves and plays the next episode now, Back skips (the card stays);
    // the countdown keeps running unless the user starts rating (then the next episode waits for the answer)
    if (wantRate()) askRate(function (score) { if (score != null || P.ended) playNext(); });
    if (P.rateH) P.rateH.note(t('r100.next', nxCount));
    clearInterval(nxTimer);
    nxTimer = setInterval(function () {
      if (P.rateH && P.rateH.touched()) { P.rateH.note(t('r100.nextWait')); return; }
      nxCount--;
      if (P.rateH) P.rateH.note(t('r100.next', Math.max(0, nxCount)));
      if (nxCount <= 0) { clearInterval(nxTimer); playNext(); } else E.nxc.textContent = t('next.count', nxCount);
    }, 1000);
  }
  function hideNext() { clearInterval(nxTimer); show(E.nx, false); }
  function nextVisible() { return !E.nx.classList.contains('hid'); }
  function playNext() {
    if (!P.next) { exit(); return; }
    postProgress('stopped', true);
    replace('player', { type: ctx.type, itemId: ctx.itemId, videoId: P.next.videoId, name: ctx.name, label: P.next.label || '', startSec: 0, sig: ctx.sig, item: ctx.item });
  }
  function onEnd() {
    P.pos = P.duration; P.ended = true;
    if (P.rateH && P.rateH.touched()) return; // the user is rating: the callback goes on (next episode / exit)
    if (P.next) playNext();
    else if (wantRate()) askRate(function () { exit(); }); // movie / last episode: ask, then leave
    else exit();
  }
  /* ---- 0-100 rating prompt after finishing (setting ratePrompt) ---- */
  function wantRate() {
    return !P.rateAsked && !P.rateH && srvSet('ratePrompt', true) !== false && !!ctx.itemId && !!ctx.videoId && P.duration > 0;
  }
  function askRate(after) { // after(score|null) runs once the user saves (score) or skips (null)
    P.rateAsked = true; P.rateAfter = after;
    P.rateH = openRate100({ itemId: ctx.itemId, videoId: ctx.videoId, type: ctx.type, name: ctx.name, label: ctx.label, movie: ctx.type === 'movie', cls: 'pl',
      onDone: function (score) { P.rateH = null; var fn = P.rateAfter; P.rateAfter = null; if (!dead && fn) fn(score); } });
  }
  function leave() { // Back/Stop: past ~90% counts as finished, so ask for the rating first
    if (P.state !== 'loading' && P.duration > 0 && P.pos >= P.duration * 0.9 && wantRate()) {
      hideNext(); pauseNow(); askRate(function () { exit(); }); return;
    }
    exit();
  }

  /* ---- seeking ---- */
  function seekKey(dir) {
    var now = Date.now();
    if (!P.seek || P.seek.dir !== dir) P.seek = { base: P.seek ? P.seek.target : P.pos, sum: 0, count: 0, last: now, target: P.pos, dir: dir };
    else if (now - P.seek.last > 700) { P.seek.count = 0; }
    var s = P.seek; s.last = now; s.count++;
    var step = s.count <= 3 ? 10 : s.count <= 8 ? 30 : 60;
    s.sum += dir * step;
    s.target = clamp(s.base + s.sum, 0, P.duration > 0 ? P.duration - 3 : 1e9);
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      var tgt = P.seek ? P.seek.target : P.pos; P.seek = null;
      applySeek(tgt);
    }, 600);
  }
  function applySeek(sec) {
    if (P.state === 'loading' || P.err) return;
    var d = P.duration;
    sec = clamp(sec, 0, d > 5 ? d - 3 : sec);
    P.pos = sec; setSpin(true); curCue = ''; E.sub.textContent = '';
    var g = gen;
    enqueue(function () { if (g !== gen || dead) return; return avAsync('seekTo', Math.floor(sec * 1000), 20000); }).then(function () {
      if (g !== gen || dead) return;
      setSpin(false);
      if (P.subId) loadSubs();
      if (osdVisible()) renderBar();
    }).catch(function (er) { if (g === gen && !dead) showError(t('err.seek', er.message)); });
  }
  function doSkip() { if (P.curSkip) { var e = P.curSkip.end + 0.2; show(E.skip, false); P.curSkip = null; applySeek(e); } }

  /* ---- play / pause ---- */
  function pauseNow() {
    if (P.state !== 'playing') return;
    P.state = 'paused'; show(E.ico, true); showOsd();
    var g = gen; enqueue(function () { if (g === gen) AV.pause(); });
    postProgress('paused');
  }
  function resumeNow() {
    if (P.state !== 'paused') return;
    P.state = 'playing'; show(E.ico, false); showOsd();
    var g = gen; enqueue(function () { if (g === gen) AV.play(); });
  }
  function toggle() { if (P.state === 'playing') pauseNow(); else if (P.state === 'paused') resumeNow(); }

  /* ---- subtitles ---- */
  function labelOfSub(id) { for (var i = 0; i < P.subs.length; i++) if (P.subs[i].id === id) return P.subs[i].label || id; return id; }
  function setSub(id, quiet) {
    P.subId = id; P.cues = []; P.cueKeys = {}; curCue = ''; setCue('');
    P.subOff = id ? store.get('subman:' + ctx.videoId + '|' + labelOfSub(id), 0) || 0 : 0;
    if (id && !/^emb:/.test(id)) startSync(id, false);
    if (!quiet) store.set('subpref:' + ctx.itemId, { label: id ? labelOfSub(id) : 'off', off: P.subOff });
    clearInterval(subTimer);
    if (id) {
      loadSubs();
      subTimer = setInterval(loadSubs, 10000);
      if (!quiet) toast(t('sub.on', labelOfSub(id)));
    } else if (!quiet) toast(t('sub.off'));
  }
  function fmtOff(v) { v = Math.round((v || 0) * 10) / 10; var n = Math.abs(v).toFixed(1); if (LANG === 'pt') n = n.replace('.', ','); return (v > 0 ? '+' : v < 0 ? '−' : '±') + n + ' s'; }
  // Manual fine-tuning on top of the automatic alignment (+ = subtitle later). Remembered per episode + track.
  function nudgeSub(d) {
    P.subOff = Math.round((P.subOff + d) * 10) / 10;
    if (P.subId) store.set('subman:' + ctx.videoId + '|' + labelOfSub(P.subId), P.subOff);
    curCue = '';
    toast(t('sub.nudge', fmtOff(P.subOff)) + (P.subOff > 0 ? t('sub.later') : P.subOff < 0 ? t('sub.earlier') : ''));
  }
  // Automatic alignment runs on the server while the video plays; cues reload when it lands.
  function startSync(id, force) {
    if (!P.session || !id) return;
    P.sync = P.sync || {};
    var ses = P.session;
    post('/api/subsync', { session: ses, subId: id, pos: Math.floor(P.pos), force: !!force }, 8000).then(function (st) {
      if (dead || ses !== P.session) return;
      P.sync[id] = st; refreshSubsPanel();
      if (st.state === 'running') pollSync(id, ses, 0); else if (st.state === 'done') applySync(id, st, true);
    }).catch(NOOP);
  }
  function pollSync(id, ses, n) {
    setTimeout(function () {
      if (dead || ses !== P.session || n > 100) return;
      xhr('GET', '/api/subsync?session=' + ses + '&subId=' + encodeURIComponent(id), undefined, 8000).then(function (st) {
        if (dead || ses !== P.session) return;
        P.sync[id] = st; refreshSubsPanel();
        if (st.state === 'running') pollSync(id, ses, n + 1);
        else if (st.state === 'done') applySync(id, st, false);
        else if (id === P.subId && (st.state === 'unsure' || st.state === 'failed')) toast(t('sub.syncFail'));
      }).catch(function () { pollSync(id, ses, n + 1); });
    }, 3000);
  }
  function applySync(id, st, quiet) {
    if (id !== P.subId) return;
    P.cues = []; P.cueKeys = {}; curCue = ''; loadSubs();
    if (!quiet && (st.offset || st.ratio !== 1)) toast(t('sub.synced', fmtOff(st.offset)));
  }
  function toggleAutoSync() {
    var id = P.subId; if (!id || !P.session) return;
    var st = (P.sync || {})[id];
    if (st && st.state === 'running') return;
    if (st && st.state === 'done') {
      post('/api/subsync/reset', { session: P.session, subId: id }, 8000).then(function (r) {
        P.sync[id] = r; P.cues = []; P.cueKeys = {}; curCue = ''; loadSubs(); refreshSubsPanel(); toast(t('sub.syncOff'));
      }).catch(NOOP);
    } else startSync(id, true);
  }
  function refreshSubsPanel() { if (P.panel && P.panel.type === 'subs') openPanel('subs', P.panel.idx); if (P.panel && P.panel.type === 'audio') openPanel('audio', P.panel.idx); }
  function startXdub() {
    if (!P.session) return;
    var ses = P.session;
    P.xdub = { state: 'running' };
    post('/api/xdub', { session: ses, pos: Math.floor(P.pos) }, 8000).then(function (x) { P.xdub = x; refreshSubsPanel(); if (x.state === 'running') pollXdub(ses, 0); }).catch(function () { P.xdub = { state: 'failed', msg: t('err.generic') }; });
  }
  function pollXdub(ses, n) {
    setTimeout(function () {
      if (dead || ses !== P.session || n > 120) return;
      xhr('GET', '/api/xdub?session=' + ses, undefined, 8000).then(function (x) {
        if (dead || ses !== P.session) return;
        P.xdub = x; refreshSubsPanel();
        if (x.state === 'running') pollXdub(ses, n + 1);
        else if (x.state === 'ready') toast(t('xd.found'));
        else toast(t('xd.msg', x.msg || t('xd.notFound')));
      }).catch(function () { pollXdub(ses, n + 1); });
    }, 4000);
  }
  function loadSubs() {
    if (!P.subId || !P.session || dead) return;
    var id = P.subId, ses = P.session, t = P.pos - P.subOff;
    xhr('GET', '/api/subs/' + ses + '/' + encodeURIComponent(id) + '?from=' + Math.max(0, Math.floor(t - 5)) + '&to=' + Math.floor(t + 60), undefined, 8000).then(function (d) {
      if (dead || id !== P.subId || ses !== P.session) return;
      (d.cues || []).forEach(function (c) {
        var k = c[0] + '|' + c[2];
        if (!P.cueKeys[k]) { P.cueKeys[k] = 1; P.cues.push(c); }
      });
      if (P.cues.length > 150) {
        var lo = P.pos - P.subOff - 40;
        P.cues = P.cues.filter(function (c) { return c[1] > lo; });
        P.cueKeys = {}; P.cues.forEach(function (c) { P.cueKeys[c[0] + '|' + c[2]] = 1; });
      }
    }).catch(NOOP);
  }

  /* ---- side panels (audio / subtitles / sources) ---- */
  function panelHeader(title) { E.pnl.textContent = ''; var hd = h('div', 'ph1', title); E.pnl.appendChild(hd); }
  function buildItems(type) {
    var items = [];
    if (type === 'eps') {
      var vs = ((P.meta && P.meta.videos) || []).slice().sort(function (a, b) {
        var sa = a.season > 0 ? a.season : 1e6, sb = b.season > 0 ? b.season : 1e6;
        return sa - sb || a.episode - b.episode;
      });
      var lastSeason = null;
      vs.forEach(function (v) {
        if (v.season !== lastSeason) { lastSeason = v.season; items.push({ hd: v.season > 0 ? t('pn.season', v.season) : t('pn.specials') }); }
        var cur = v.id === ctx.videoId;
        items.push({ t: 'ep', v: v, on: cur, label: 'E' + v.episode + ' · ' + (v.title || t('detail.episode', v.episode)) + (cur ? t('pn.playing') : v.watched ? t('pn.watched') : '') });
      });
      if (!vs.length) items.push({ hd: t('pn.noEps') });
      return items;
    }
    if (type === 'audio') {
      if (!P.audio.length) items.push({ hd: t('pn.oneAudio') });
      P.audio.forEach(function (a) { items.push({ t: 'audio', a: a, label: a.label || t('pn.track', a.aIdx + 1), on: a.aIdx === P.audioIdx }); });
      // Experimental: dubbed audio taken from another release, aligned automatically. Only on request, never automatic.
      if (!P.hasPtAudio && P.audioIdx !== -1) {
        var x = P.xdub || { state: 'none' };
        items.push({ hd: t('pn.experimental') });
        if (x.state === 'none' || x.state === 'failed' || x.state === 'notfound') items.push({ t: 'xfind', label: x.state === 'none' ? t('pn.xfind') : t('pn.xagain', x.msg || t('pn.xnone')) });
        else if (x.state === 'running') items.push({ hd: t('pn.xrun') });
        else if (x.state === 'ready') items.push({ t: 'xuse', label: t('pn.xuse') });
      }
    } else {
      items.push({ t: 'sub', id: null, label: t('val.subsOff'), on: !P.subId });
      P.subs.forEach(function (s) { items.push({ t: 'sub', id: s.id, label: s.label || s.id, on: s.id === P.subId }); });
      if (P.subId) {
        var st = (P.sync || {})[P.subId] || null, emb = /^emb:/.test(P.subId);
        items.push({ hd: t('pn.syncHead') });
        var al = st && st.state === 'done' && (st.offset || st.ratio !== 1) ? ' ' + fmtOff(st.offset) + (st.ratio !== 1 ? t('pn.speedFixed') : '') : '';
        items.push({ t: 'auto', label: emb && !st ? t('sync.unneeded')
          : !st || st.state === 'none' ? t('sync.ready')
          : st.state === 'running' ? t('sync.running')
          : st.state === 'done' ? t('sync.on') + (al || t('sync.alreadyOk')) + t('sync.onTail')
          : st.state === 'off' ? t('sync.off')
          : st.state === 'unsure' ? t('sync.unsure')
          : t('sync.failed', st.msg || t('err.generic')) });
        items.push({ t: 'fine', label: t('sync.fine', fmtOff(P.subOff)) });
        items.push({ t: 'coarse', label: t('sync.coarse', fmtOff(P.subOff)) });
        items.push({ t: 'zero', label: t('sync.zero') });
      }
    }
    return items;
  }
  function isSel(it) { return !!it.t; }
  function openPanel(type, keep) {
    var prevPanel = P.panel;
    closePanelQuiet();
    show(E.pnl, true); show(E.osd, true); E.sub.classList.add('up'); renderBar(); clearTimeout(osdTimer);
    if (type === 'src') {
      panelHeader(t('pn.sources'));
      P.panel = { type: 'src', sl: makeStreamList(E.pnl, { top: 116, height: 960, type: ctx.type, videoId: ctx.videoId, itemId: ctx.itemId, onChoose: switchSource }) };
      return;
    }
    if (type === 'eps' && !P.meta) {
      panelHeader(t('pn.episodes'));
      E.pnl.appendChild(h('div', 'pi hd', t('common.loading')));
      P.panel = { type: 'eps-loading', items: [], idx: 0, els: [] };
      cget(metaPath({ type: ctx.type, id: ctx.itemId }), 300000, 15000).then(function (m) {
        if (dead) return;
        P.meta = m || { videos: [] };
        if (P.panel && P.panel.type === 'eps-loading') openPanel('eps');
      }, function () { if (!dead && P.panel && P.panel.type === 'eps-loading') { closePanel(); toast(t('pn.epsFail')); } });
      return;
    }
    panelHeader(t(type === 'audio' ? 'pn.audio' : type === 'eps' ? 'pn.episodes' : 'pn.subs'));
    var items = buildItems(type), idx = keep != null ? keep : -1, i;
    var keepOff = keep != null && prevPanel && prevPanel.type === type ? prevPanel.off : null;
    if (idx < 0) {
      for (i = 0; i < items.length; i++) if (items[i].on) { idx = i; break; }
      if (idx < 0) { idx = 0; while (idx < items.length && !isSel(items[idx])) idx++; }
    }
    var strip = h('div', 'strip'); E.pnl.appendChild(strip);
    P.panel = { type: type, items: items, idx: idx, els: [], strip: strip, off: keepOff };
    items.forEach(function (it) {
      var e = h('div', 'pi' + (it.hd ? ' hd' : '') + (it.on ? ' on' : ''), it.hd ? it.hd : ((it.on ? '✓  ' : '') + it.label));
      strip.appendChild(e); P.panel.els.push(e);
    });
    paintPanel();
  }
  function paintPanel(hover) {
    var pn = P.panel; if (!pn || !pn.els) return;
    pn.els.forEach(function (e, i) { setF(e, i === pn.idx); });
    if (RESP) { // [client] the visible window is kept apart from the focus, so hovering with the mouse never scrolls the list
      var vis = 12, mx = Math.max(0, pn.els.length - vis);
      if (pn.off == null) pn.off = clamp(pn.idx - 9, 0, mx);
      else if (!hover) { if (pn.idx < pn.off) pn.off = pn.idx; else if (pn.idx > pn.off + vis - 1) pn.off = pn.idx - vis + 1; }
      tx(pn.strip, 0, -pn.off * 74);
      return;
    }
    tx(pn.strip, 0, -Math.max(0, pn.idx - 9) * 74);
  }
  function closePanelQuiet() { if (P.panel && P.panel.sl) P.panel.sl.destroy(); P.panel = null; E.pnl.textContent = ''; }
  function closePanel() { closePanelQuiet(); show(E.pnl, false); if (P.state === 'error') { var m = P.errMsg; P.err = null; showError(m); return; } showOsd(); }
  function panelKey(k) {
    var pn = P.panel;
    if (k === 'back') { closePanel(); return; }
    if (pn.type === 'src') { if (pn.sl.key(k) === 'left') closePanel(); return; }
    if (pn.type === 'eps-loading') { if (k === 'left') closePanel(); return; }
    var cur = pn.items[pn.idx];
    if ((k === 'left' || k === 'right') && cur && (cur.t === 'fine' || cur.t === 'coarse')) {
      nudgeSub((k === 'right' ? 1 : -1) * (cur.t === 'fine' ? 0.1 : 1)); openPanel('subs', pn.idx); return;
    }
    if (k === 'left') { closePanel(); return; }
    if (k === 'up' || k === 'down') {
      var d = k === 'up' ? -1 : 1, i = pn.idx + d;
      while (i >= 0 && i < pn.items.length && !isSel(pn.items[i])) i += d;
      if (i >= 0 && i < pn.items.length) pn.idx = i;
      paintPanel(); return;
    }
    if (k === 'enter') {
      var it = pn.items[pn.idx], ix = pn.idx;
      if (!it.t) return;
      if (it.t === 'ep') { if (it.v.id === ctx.videoId) closePanel(); else switchEpisode(it.v); return; }
      if (it.t === 'auto') { toggleAutoSync(); openPanel('subs', ix); return; }
      if (it.t === 'fine' || it.t === 'coarse') return;
      if (it.t === 'zero') { nudgeSub(-P.subOff); openPanel('subs', ix); return; }
      if (it.t === 'xfind') { startXdub(); openPanel('audio', ix); return; }
      if (it.t === 'xuse') { closePanel(); P.xdubWant = true; toast(t('xd.switching')); P.cues = []; P.cueKeys = {}; begin(P.pos, null); return; }
      if (it.t === 'audio') { closePanel(); if (it.a.aIdx !== P.audioIdx) switchAudio(it.a.aIdx); }
      else if (it.t === 'sub') { setSub(it.id); openPanel('subs', ix); }

    }
  }
  function switchAudio(aIdx) {
    if (aIdx === -1) return;
    P.xdubWant = false;
    toast(t('tt.audio'));
    P.audio.forEach(function (a) { if (a.aIdx === aIdx) store.set('audiopref:' + ctx.itemId, { label: a.label }); });
    P.cues = []; P.cueKeys = {};
    begin(P.pos, aIdx);
  }
  function switchEpisode(v) {
    closePanelQuiet();
    postProgress('stopped', true);
    replace('player', { type: ctx.type, itemId: ctx.itemId, videoId: v.id, name: ctx.name, label: epLabel(v.season, v.episode), startSec: 0, sig: ctx.sig, item: ctx.item });
  }
  function switchSource(s) {
    closePanel();
    toast(t('tt.source'));
    if (s) { P.sid = s.sid; ctx.sid = s.sid; ctx.sig = sigOf(s); ctx.noMem = false; store.set('lastsid:' + ctx.videoId, s.sid); }
    else { P.sid = null; ctx.sid = null; ctx.sig = null; ctx.noMem = true; }
    P.sidMem = false; P.cues = []; P.cueKeys = {};
    begin(P.pos, P.audioIdx || null);
  }
  // One-key subtitle on/off (▼, CC or blue): off remembers the track; on restores it or picks the best.
  function quickSub() {
    if (P.subId) { P.lastSubId = P.subId; setSub(null); return; }
    if (!P.subs.length) { toast(t('sub.none')); return; }
    var id = P.lastSubId, pref = store.get('subpref:' + ctx.itemId, null);
    if (!id && pref && pref.label !== 'off') P.subs.forEach(function (x) { if (!id && x.label === pref.label) id = x.id; });
    if (!id) { var keep = P.settings.subLang; if (!keep || keep === 'off') P.settings.subLang = 'pt'; store.set('subpref:' + ctx.itemId, null); autoSub(); P.settings.subLang = keep; if (P.subId) { toast(t('sub.named', labelOfSub(P.subId))); store.set('subpref:' + ctx.itemId, { label: labelOfSub(P.subId), off: P.subOff }); return; } id = P.subs[0].id; }
    setSub(id);
  }
  function otherSource() { P.err = null; show(E.err, false); openPanel('src'); }
  function ctlKey(k) {
    if (k === 'left') P.ctl = Math.max(0, P.ctl - 1);
    else if (k === 'right') P.ctl = Math.min(E.ctls.length - 1, P.ctl + 1);
    else if (k === 'down' || k === 'back') { P.ctl = -1; }
    else if (k === 'enter') {
      var cn = E.ctlNames[P.ctl];
      if (cn === 'pause') toggle(); else if (cn === 'party') SPP.open(); else openPanel(cn === 'cc' ? 'subs' : cn);
    } else if (k === 'up') { /* stay */ }
    else if (k === 'toggle') toggle();
    showOsd(); paintCtl();
  }

  /* ---- progress / watchdog ---- */
  function postProgress(state, force) {
    if (!P.session && !force) return;
    if (state === 'stopped') { if (P.stopped) return; P.stopped = true; }
    if (!ctx.itemId) return;
    post('/api/progress', {
      itemId: ctx.itemId, videoId: ctx.videoId, type: ctx.type, name: ctx.name,
      positionSec: Math.floor(P.pos), durationSec: Math.floor(P.duration), state: state
    }, 6000).catch(NOOP);
  }
  function startTimers() {
    if (progTimer) return;
    progTimer = setInterval(function () { if (P.state === 'playing') postProgress('playing'); }, 30000);
    memTimer = setInterval(function () {
      var m = readMemMiB();
      if (m != null && m < 110 && !P.low) lowMem();
    }, 5000);
  }
  function lowMem() {
    P.low = true; P.state = 'stopped';
    postProgress('stopped');
    enqueue(function () { try { AV.stop(); } catch (e) {} try { AV.close(); } catch (e) {} });
    setSpin(false);
    E.errt.textContent = t('err.lowMem');
    E.errb[0].textContent = t('common.back'); show(E.errb[1], false); setF(E.errb[0], true);
    show(E.err, true);
  }
  function showError(msg) {
    if (P.err || P.low) return;
    P.err = msg; P.errMsg = msg; P.state = 'error'; setSpin(false);
    E.errt.textContent = msg;
    E.errb[0].textContent = t('common.retry'); show(E.errb[1], true);
    errIdx = 0; setF(E.errb[0], true); setF(E.errb[1], false);
    show(E.err, true); show(E.skip, false);
  }
  function exit() {
    postProgress('stopped', true);
    cache.clear();
    var has = false;
    for (var i = 0; i < nav.stack.length; i++) if (nav.stack[i].name === 'detail') has = true;
    if (has) popTo('detail'); else pop();
  }

  /* watch-along bridge (see spp-party.js): read-only state + the three player actions */
  function partyApi() {
    return {
      root: $root, base: function () { return BASE; }, lang: function () { return LANG; }, toast: toast,
      getState: function () { return { session: P.session, state: P.state, pos: P.pos, duration: P.duration, title: ctx.name || '', label: ctx.label || '', subId: P.subId, subOff: P.subOff, subLabel: P.subId ? labelOfSub(P.subId) : '' }; },
      pause: pauseNow, play: resumeNow, seek: applySeek
    };
  }

  /* ---- [client] mouse / touch ---- */
  var lastOsdMove = 0;
  function seekAt(x, hold) { // click / drag on the seek bar
    if (P.duration <= 0 || P.state === 'loading') return;
    var r = E.bar.getBoundingClientRect(), tgt = clamp((x - r.left) / (r.width || 1), 0, 1) * P.duration;
    tgt = clamp(tgt, 0, Math.max(0, P.duration - 3));
    clearTimeout(seekTimer);
    if (hold) { P.seek = { base: P.pos, sum: 0, count: 0, last: Date.now(), target: tgt, dir: 0 }; showOsd(); }
    else { P.seek = null; applySeek(tgt); showOsd(); }
  }
  function toggleMute() {
    var v = AV === window.AVHTML5 ? AV.video() : null;
    if (!v) return;
    v.muted = !v.muted; toast(t(v.muted ? 'pl.muted' : 'pl.unmuted'));
  }
  function volume(dir) {
    var v = AV === window.AVHTML5 ? AV.video() : null;
    if (!v) return;
    v.muted = false; v.volume = clamp(Math.round((v.volume + dir * 0.05) * 100) / 100, 0, 1);
    toast(t('pl.volume', Math.round(v.volume * 100)));
  }
  function dragSeek(type, el, d) { // a press on the seek bar is captured: dragging previews, releasing seeks
    if (type === 'down') return !P.panel && !P.err && !P.low && osdVisible() && !!up(el, 'obhit');
    seekAt(d.x, type === 'drag');
    return true;
  }
  function point(type, el, d) {
    if (P.err || P.low) { // error box
      var eb = inside(el, E.err) ? E.errb.indexOf(up(el, 'btn')) : -1;
      if (eb >= 0) {
        if (type === 'move' && !P.low) { errIdx = eb; setF(E.errb[0], eb === 0); setF(E.errb[1], eb === 1); }
        else if (type === 'click') { errIdx = P.low ? 0 : eb; api.key('enter'); }
      }
      return true;
    }
    var pn = P.panel;
    if (pn) {
      if (!inside(el, E.pnl)) { if (type === 'click') closePanel(); return true; } // a click on the video side closes the panel
      if (type === 'wheel') {
        if (pn.type === 'src') pn.sl.scroll(d.dy || 0);
        else if (pn.els && d.dy) { pn.off = clamp((pn.off || 0) + d.dy, 0, Math.max(0, pn.els.length - 12)); paintPanel(true); }
        return true;
      }
      if (up(el, 'ph1')) { if (type === 'click') closePanel(); return true; }
      if (pn.type === 'src') return pn.sl.point(type, el, d);
      var pi = pn.els ? pn.els.indexOf(up(el, 'pi')) : -1;
      if (pi >= 0 && pn.items[pi].t) {
        var it = pn.items[pi];
        if (type === 'move') { if (pn.idx !== pi) { pn.idx = pi; paintPanel(true); } }
        else if (type === 'click') {
          pn.idx = pi; paintPanel(true);
          if (it.t === 'fine' || it.t === 'coarse') { var pr = pn.els[pi].getBoundingClientRect(); nudgeSub((d.x < pr.left + pr.width / 2 ? -1 : 1) * (it.t === 'fine' ? 0.1 : 1)); openPanel('subs', pi); }
          else panelKey('enter');
        }
      }
      return true;
    }
    if (type === 'wheel') {
      if (d.swipe && d.dx) { for (var n = Math.abs(d.dx); n > 0; n--) seekKey(d.dx > 0 ? 1 : -1); } // touch: horizontal swipe seeks
      else if (!d.swipe && d.dy) volume(d.dy > 0 ? -1 : 1);
      return true;
    }
    if (type === 'dblclick') { if (window.SPP_CLIENT.fullscreen) window.SPP_CLIENT.fullscreen(); return true; }
    if (nextVisible() && inside(el, E.nx)) { if (type === 'click') playNext(); return true; }
    if (!E.skip.classList.contains('hid') && inside(el, E.skip)) { if (type === 'click') doSkip(); return true; }
    var ci = E.ctls.indexOf(up(el, 'ctl'));
    if (ci >= 0) { if (type === 'click') { P.ctl = ci; ctlKey('enter'); P.ctl = -1; paintCtl(); } return true; }
    if (type === 'move') { var now = Date.now(); if (!osdVisible() || now - lastOsdMove > 800) { lastOsdMove = now; showOsd(); } return true; }
    if (type === 'click') { if (osdVisible()) hideOsd(); else showOsd(); return true; }
    return false;
  }

  var api = {
    mount: function () {
      build();
      setSpin(true);
      if (window.SPP) SPP.attach(partyApi());
      cget('/api/settings', 60000, 4000).then(function (s) { P.settings = s || {}; }, NOOP).then(function () {
        if (!dead) begin(ctx.startSec || 0, null);
      });
    },
    unmount: function () {
      dead = true; gen++;
      clearTimeout(osdTimer); clearInterval(progTimer); clearInterval(memTimer); clearInterval(subTimer);
      clearInterval(nxTimer); clearTimeout(seekTimer); clearTimeout(toastTimer);
      if (P.rateH) { P.rateH.close(); P.rateH = null; }
      if (P.session && !P.stopped) postProgress('stopped');
      cache.delete('/api/home'); cache.delete('/api/history'); cache.delete(metaPath({ type: ctx.type, id: ctx.itemId }));
      if (P.panel && P.panel.sl) P.panel.sl.destroy();
      var ses = P.session;
      enqueue(function () { try { AV.stop(); } catch (e) {} try { AV.close(); } catch (e) {} });
      if (ses) xhr('DELETE', '/api/session/' + ses, undefined, 4000).catch(NOOP);
      document.documentElement.classList.remove('playing');
      if (window.SPP) SPP.detach();
    },
    key: function (k) {
      if (window.SPP && SPP.key(k)) return;
      if (P.low) { if (k === 'enter' || k === 'back') exit(); return; }
      if (P.err) {
        if (k === 'left' || k === 'right') {
          errIdx = clamp(errIdx + (k === 'left' ? -1 : 1), 0, 1); setF(E.errb[0], errIdx === 0); setF(E.errb[1], errIdx === 1);
        } else if (k === 'enter') {
          if (errIdx === 0) { var pos = P.pos; P.err = null; begin(pos, P.audioIdx || null); } else otherSource();
        } else if (k === 'back') exit();
        return;
      }
      if (P.panel) { panelKey(k); return; }
      if (P.ctl >= 0) { ctlKey(k); return; }
      if (nextVisible()) {
        if (k === 'enter') { playNext(); return; }
        if (k === 'back') { P.nextDismissed = true; hideNext(); return; }
      }
      switch (k) {
        case 'back': case 'stop': leave(); return;
        case 'left': case 'rw': seekKey(-1); return;
        case 'right': case 'ff': seekKey(1); return;
        case 'up': P.ctl = 0; showOsd(); paintCtl(); return;
        case 'down': case 'cc': case 'blue': quickSub(); return;
        case 'enter': if (!E.skip.classList.contains('hid')) doSkip(); else toggle(); return;
        case 'toggle': toggle(); return;
        case 'play': resumeNow(); return;
        case 'pause': pauseNow(); return;
        default: showOsd();
      }
    },
    other: function (e) {
      if (RESP && e && e.key) { // [client] F fullscreen, M mute (F11 is handled by the window)
        var c = e.key.toLowerCase();
        if (c === 'f') { if (window.SPP_CLIENT.fullscreen) window.SPP_CLIENT.fullscreen(); return; }
        if (c === 'm') { toggleMute(); return; }
      }
      if (!P.err && !P.low) showOsd();
    },
    point: point,
    drag: dragSeek,
    restage: function () { layoutCtl(); renderBar(); },
    modality: function () { layoutCtl(); },
    _P: P
  };
  return api;
};

/* ---------- start ---------- */
window.__spp = { mount: mount, nav: nav, cache: cache, keyStats: keyStats, store: store, version: VERSION, player: function () { return nav.cur && nav.cur._P; },
  pointer: pointer, modality: modality, restage: restage, resp: RESP };
registerKeys();
boot();
})();

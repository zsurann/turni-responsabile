# Turni · Responsabile (La Falco)

PWA per il responsabile: compila i turni per postazione e mese e li pubblica sul Worker `turni-sync`, da cui li legge l'app dei turnisti.

## File

| File | Contenuto |
|---|---|
| `index.html` | Struttura della pagina |
| `manager.js` | Tutta la logica (stato, categorie, conflitti, pubblicazione, interfaccia) |
| `style.css` / `manager.css` | Stili di base / stili dell'editor (incluso `@media print`) |
| `config.js` | Indirizzo del Worker (`self.TURNI_API`) |
| `sw.js` | Service worker: rete prima, copia offline come riserva |
| `_headers` | Header HTTP (Cloudflare Pages), compresa la Content-Security-Policy |

## Rilascio: cose da ricordare

1. **Aumenta `CACHE` in `sw.js`** (es. `resp-v8` → `resp-v9`) a ogni modifica, altrimenti le app installate possono restare alla versione vecchia.
2. Se cambi l'indirizzo del Worker in `config.js`, aggiornalo anche in `connect-src` dentro `_headers`, altrimenti il browser blocca le chiamate.

## API del Worker usate dall'app

| Metodo | Percorso | Auth | Uso |
|---|---|---|---|
| `GET` | `/api/auth` | `Bearer <password>` | Verifica password (200 ok, 401 errata, 429 troppi tentativi) |
| `GET` | `/api/schedule` | – | `{ version, docs, employees, customStructures, deletedCategories, deletedTitles }` |
| `PUT` | `/api/schedule` | `Bearer` | Sostituisce tutto; il corpo contiene anche `baseVersion` (versione su cui si basa la bozza). Risponde `{ version }` |
| `POST` | `/api/notify` | `Bearer` | `{ title, body, cursor }` → `{ sent, done, cursor }`, a blocchi |

### Modifiche consigliate lato Worker (il codice non è in questo repository)

- **Controllo di versione**: se `baseVersion` è presente e diverso dalla versione salvata, rispondere **409**. L'app gestisce già il 409 ("ci sono turni più recenti"). Lato client c'è comunque già un controllo prima di ogni pubblicazione.
- **Limite ai tentativi** su `/api/auth` (rispondere 429): l'app mostra già il messaggio giusto.
- **Token di sessione** con scadenza al posto della password inviata a ogni richiesta.
- **Privacy**: `GET /api/schedule` è pubblico e contiene i nomi dei dipendenti; valutare una chiave anche per l'app dei turnisti.
- Conservare il codice del Worker in questo repository (es. cartella `worker/`).

## Comportamenti principali

- **Bozza locale**: le modifiche restano nel dispositivo finché non premi *Pubblica turni*. Se un altro dispositivo ha pubblicato nel frattempo, l'app avvisa prima di sovrascrivere e, se la bozza è pulita, si aggiorna da sola.
- **Avvisi push ripresi**: se l'invio delle notifiche si interrompe, *Invia avviso* riparte dal punto raggiunto (niente notifiche doppie). L'avviso nomina solo i mesi cambiati.
- **Conflitti**: le caselle con la stessa persona in turni sovrapposti (rosso) o con meno di 11 ore di riposo (arancione) sono evidenziate; il selettore lo segnala prima di assegnare.
- **Storico**: a ogni pubblicazione vengono inviati gli ultimi 12 mesi.
- **Parole riservate** (non diventano dipendenti): `NO`, `RIPOSO`, `FERIE`, `MALATTIA`, `PERMESSO`, `FESTIVO`, `RECUPERO`, `LIBERO`, `ASSENTE`, `SCOPERTO`, `CHIUSO`, `ROL`, `CONGEDO`, `INFORTUNIO`.
- **Accesso**: la password non viene mai salvata: l'app la chiede a ogni apertura (anche dopo un ricaricamento). La bozza dei turni resta invece salvata sul dispositivo.

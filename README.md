# Turni · Responsabile (La Falco)

PWA per il responsabile: compila i turni per postazione e mese e li pubblica sul Worker `turni-sync`, da cui li legge l'app dei turnisti.

## File

| File | Contenuto |
|---|---|
| `index.html` | Struttura della pagina |
| `manager.js` | Tutta la logica (stato, categorie, conflitti, pubblicazione, interfaccia) |
| `style.css` / `manager.css` | Base, accesso, struttura e pannelli / tabella, vista per giorno, stampa |
| `fonts/` | Carattere Inter incluso nell'app (licenza SIL OFL, `fonts/OFL.txt`): niente Google Fonts, funziona offline |
| `config.js` | Indirizzo del Worker (`self.TURNI_API`) |
| `sw.js` | Service worker: rete prima, copia offline come riserva |
| `_headers` | Header HTTP (Cloudflare Pages), compresa la Content-Security-Policy |

## Rilascio: cose da ricordare

1. **Aumenta `CACHE` in `sw.js`** (es. `resp-v13` → `resp-v14`) a ogni modifica, altrimenti le app installate possono restare alla versione vecchia.
2. Se cambi l'indirizzo del Worker in `config.js`, aggiornalo anche in `connect-src` dentro `_headers`, altrimenti il browser blocca le chiamate.

## API del Worker `turni-sync` usate dall'app

Il codice del Worker non è in questo repository: si gestisce dal pannello Cloudflare.

| Metodo | Percorso | Auth | Uso |
|---|---|---|---|
| `GET` | `/api/auth` | `Bearer <password>` | Verifica password (200 ok, 401 errata, 429 troppi tentativi) |
| `GET` | `/api/schedule` | `Bearer` (facoltativa) | Senza password: `{ version, docs }` (app dei turnisti). Con la password: anche `employees`, `customStructures`, `deletedCategories`, `deletedTitles` |
| `PUT` | `/api/schedule` | `Bearer` | Sostituisce tutto. `baseVersion` = versione su cui si basa la bozza: se sul server ce n'è una diversa risponde **409**. Risponde `{ version }` |
| `POST` | `/api/notify` | `Bearer` | `{ title, body, cursor }` → `{ sent, done, cursor }`, a gruppi di 40 iscritti |
| `GET` / `PUT` | `/api/draft` | `Bearer` | Bozza non pubblicata condivisa tra i dispositivi del responsabile. `PUT` con `baseRev`: se un altro dispositivo ha salvato nel frattempo risponde **409** e l'app chiede quale bozza tenere |

Limiti del Worker: fino a 400 fogli (postazioni × mesi) per pubblicazione; dopo 10 password sbagliate in 15 minuti lo stesso indirizzo IP riceve 429.

Se la versione del Worker è precedente (limite di 60 fogli, dati di gestione non salvati), l'app mostra "aggiorna il Worker turni-sync" quando la pubblicazione viene rifiutata.

## Comportamenti principali

- **Bozza condivisa tra computer e telefono**: le modifiche non pubblicate vengono salvate anche sul Worker (2 secondi dopo l'ultima modifica, al massimo una volta ogni 15 secondi, e subito quando l'app va in background). Gli altri dispositivi le ricevono da soli in pochi secondi (controllo ogni 8 secondi). Se due dispositivi modificano quasi insieme, le modifiche si uniscono da sole; l'app chiede quale bozza tenere solo se è stata cambiata la stessa casella. I turnisti vedono solo i turni pubblicati.
- **Blocco per inattività**: dopo 30 minuti senza toccare l'app viene richiesta di nuovo la password. La bozza resta salvata.
- **Aggiornamento**: quando cambia `sw.js` l'app aperta si ricarica da sola, se non c'è un pannello aperto.
- **Pubblicazione**: se un altro dispositivo ha pubblicato nel frattempo, l'app avvisa prima di sovrascrivere.
- **Avvisi push ripresi**: se l'invio delle notifiche si interrompe, *Invia avviso* riparte dal punto raggiunto (niente notifiche doppie). L'avviso nomina solo i mesi cambiati.
- **Conflitti** (in rosso): stessa persona in turni sovrapposti, oppure turno che inizia entro 1 ora dalla fine di una notte ("viene dalla notte"). Il pannello di assegnazione lo segnala prima di assegnare. Non c'è più l'avviso sul riposo minimo di 11 ore.
- **Storico**: a ogni pubblicazione vengono inviati gli ultimi 12 mesi.
- **Parole riservate** (non diventano dipendenti): `NO`, `RIPOSO`, `FERIE`, `MALATTIA`, `PERMESSO`, `FESTIVO`, `RECUPERO`, `LIBERO`, `ASSENTE`, `SCOPERTO`, `CHIUSO`, `ROL`, `CONGEDO`, `INFORTUNIO`.
- **Accesso**: la password resta valida solo finché l'app è aperta (sopravvive al ricaricamento della pagina); chiudendo e riaprendo l'app viene richiesta di nuovo. La bozza dei turni resta salvata sul dispositivo.
- **Interfaccia**: su computer barra laterale con le categorie a fisarmonica (una aperta alla volta, ognuna col suo colore), tabella e pannello di assegnazione a destra; su telefono vista per giorno, scelta della postazione in alto e pubblicazione in basso.

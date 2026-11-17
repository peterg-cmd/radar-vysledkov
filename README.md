# Radar výsledkov

Prehľad blížiacich sa kvartálnych výsledkov amerických firiem. Zobrazuje odhady analytikov z viacerých verejných zdrojov a jednoduchý štatistický odhad, ako firma dopadne.

> Ide o analytický nástroj, nie o investičné odporúčanie. Smer pohybu ceny po výsledkoch sa spoľahlivo predpovedať nedá.

## Čo aplikácia ukazuje

| Údaj | Zdroj |
|---|---|
| Kalendár výsledkov (dátum, ráno/večer), všetky firmy na 14 dní | Nasdaq.com |
| Konsenzus EPS a tržieb, rozpätie, počet analytikov | Yahoo Finance + Nasdaq (porovnanie) |
| Revízie odhadov (7/30/60/90 dní, počet revízií nahor/nadol) | Yahoo Finance + Nasdaq |
| História: odhad, skutočnosť a prekvapenie za posledné 4 štvrťroky | Nasdaq + Yahoo |
| Reakcia ceny po minulých výsledkoch | výpočet z cien (Yahoo) |
| Očakávaný pohyb podľa opcií (ATM straddle) | Yahoo Finance |
| Odporúčania analytikov a cieľová cena | Yahoo Finance |
| Odkazy na overenie: Google Finance, Earnings Whispers, Zacks | odkazy |

**Pravdepodobnosť prekonania odhadu** vychádza z histórie firmy, pričom sa berie do úvahy aj dlhodobý priemer (~75 % firiem prekoná odhad). Výsledok sa ešte upraví podľa revízií odhadov.
**Sklon (−100 až +100)** kombinuje viac faktorov: históriu prekvapení (25 %), revízie odhadov (30 %), minulé reakcie ceny (20 %), nárast ceny pred výsledkami (15 %, pôsobí opačne) a odporúčania analytikov (10 %).

## Spustenie na PC

Potrebný je iba [Node.js](https://nodejs.org) vo verzii 18 alebo novšej. Na tvojom PC už je.

1. Dvakrát klikni na **`spusti.bat`**.
2. Skript za 1–3 minúty stiahne aktuálne dáta a otvorí stránku v prehliadači.

Alternatíva cez príkazový riadok: `node fetch.mjs`, potom otvor `site/index.html`.

## Nastavenie

Súbor **`config.json`**:

- `watchlist`: tvoje firmy, ktoré sa analyzujú vždy.
- `upcoming.days`: na koľko dní dopredu sa načíta kalendár.
- `upcoming.minMarketCapUSD` a `upcoming.maxCompanies`: ktoré ďalšie veľké firmy s blížiacimi sa výsledkami sa pridajú do analýzy automaticky.

## Zverejnenie na GitHube (webová adresa pre mobil)

1. Na [github.com](https://github.com) vytvor nový repozitár, napr. `radar-vysledkov`.
2. Nahraj doň obsah tohto priečinka, vrátane priečinka `.github`.
3. V repozitári otvor **Settings → Pages → Build and deployment → Source** a zvoľ **GitHub Actions**.
4. V záložke **Actions** spusti workflow „Aktualizovať a zverejniť web“ (tlačidlo *Run workflow*).
5. O pár minút bude stránka dostupná na `https://<tvoje-meno>.github.io/radar-vysledkov/`.

Dáta sa potom obnovujú automaticky v pracovné dni o 12:00 a 22:30 nášho času. Kedykoľvek ich obnovíš aj ručne cez *Run workflow*.

**Upozornenie:** na bezplatnom účte musí byť repozitár pre GitHub Pages **verejný**. Watchlist v `config.json` teda uvidí ktokoľvek. Aplikácia nepoužíva žiadne heslá ani API kľúče.

## Obmedzenia

- Yahoo aj Nasdaq sú neoficiálne verejné rozhrania. Ak niečo zmenia, sťahovanie môže prestať fungovať a skript bude treba upraviť.
- Google Finance nemá verejné API, preto je pri každej firme len odkaz naň.
- História obsahuje iba posledné 4 štvrťroky, čo je pre štatistiku málo.

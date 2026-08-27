# 🐱🚜 VierCleanÓwno

Prosta przeglądarkowa gra 3D (Three.js). Pomóż Panu Januszowi posprzątać
łąkę z niepożądanych przedmiotów, żeby mógł wywieźć je na płytę
obornikową. Uważaj, żeby nie przejechać kota!

Gra działa w 100% w przeglądarce (bez backendu, bez buildowania) —
Three.js jest wczytywany z CDN.

## Jak zagrać lokalnie

Ze względu na moduły/canvas najlepiej odpalić przez lokalny serwer, np.:

```bash
python3 -m http.server 8000
```

i wejść na `http://localhost:8000`.

## Jak wystawić na GitHub Pages

1. Wrzuć zawartość tego folderu (`index.html`, `style.css`, `game.js`) do
   repozytorium na GitHubie.
2. W repo: **Settings → Pages → Source** ustaw branch `main` (lub `master`)
   i folder `/ (root)`.
3. Po chwili gra będzie dostępna pod adresem
   `https://<twoj-user>.github.io/<nazwa-repo>/`.

## Sterowanie

- `W` / `↑` — jazda do przodu
- `S` / `↓` — jazda do tyłu
- `A` / `←` — skręt w lewo
- `D` / `→` — skręt w prawo
- Na telefonie/tablecie: strzałki dotykowe na dole ekranu.

## Zasady

- 3 życia (ikonki kota).
- Najechanie na kota 🐱 = -1 życie.
- Zebranie dobrego przedmiotu (jogurt, sernik, kluczyki, pizza,
  szakszuka, kartka) = +1 punkt.
- 0 żyć = koniec gry i wynik na ekranie.

## Struktura plików

```
index.html   – struktura strony, ekrany UI
style.css    – stylowanie (kreskówkowy motyw wiejski)
game.js      – cała logika 3D i rozgrywki (Three.js)
```

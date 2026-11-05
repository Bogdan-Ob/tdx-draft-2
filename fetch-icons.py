#!/usr/bin/env python3
"""
Скачивает иконки башен с tdx.fandom.com в папку icons/ и обновляет icons/index.json.
Запускать у себя на компьютере, из папки проекта:   python fetch-icons.py
Нужен только Python 3 (внешние библиотеки не нужны). Повторный запуск докачивает недостающее.
Башни без картинки остаются с цветным бейджем-инициалами — сайт работает и так.
"""
import json, os, re, sys, urllib.parse, urllib.request

API = "https://tdx.fandom.com/api.php"
HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(HERE, "icons")
os.makedirs(ICONS, exist_ok=True)

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tdx-draft-icon-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

# Названия берём из towers.js (строки вида { name: 'Golden Ranger', status: 'pvp' })
src = open(os.path.join(HERE, "towers.js"), encoding="utf-8").read()
towers = re.findall(r"\{\s*name:\s*'([^']+)'\s*,\s*status:\s*'(pvp)'", src)
names = [n for n, _ in towers]

def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

have = set()
for name in names:
    sid = slug(name)
    path = os.path.join(ICONS, sid + ".png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        have.add(sid); continue
    title = name  # например "Ghost (Tower)" — это и есть название страницы на вики
    q = urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "pageimages", "piprop": "thumbnail",
        "pithumbsize": 128, "redirects": 1, "format": "json",
    })
    try:
        data = json.loads(get(API + "?" + q))
        page = next(iter(data["query"]["pages"].values()))
        url = page["thumbnail"]["source"]
        with open(path, "wb") as f:
            f.write(get(url))
        have.add(sid)
        print("ok      ", name)
    except Exception as e:
        print("нет     ", name, "->", type(e).__name__)

with open(os.path.join(ICONS, "index.json"), "w", encoding="utf-8") as f:
    json.dump(sorted(have), f, indent=1)
print(f"\nГотово: иконок {len(have)} из {len(names)}. Список записан в icons/index.json")

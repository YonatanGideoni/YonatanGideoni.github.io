import html
import re
import sys
from pathlib import Path

try:
    import bibtexparser
except Exception:
    print("This script requires bibtexparser. Install: pip install bibtexparser")
    raise


# ---------- Text / TeX normalization (conservative) ----------
def tex_normalize(s: str) -> str:
    if not s:
        return ''
    # \command{...} -> inner
    s = re.sub(r'\\[A-Za-z@]+(?:\s*\*)?\s*\{([^}]*)\}', r'\1', s)
    # accents like \~u, \^a, \"o, \`e, \'{i} -> letter
    s = re.sub(r'\\[`\'"^~=.uvHcdbk]?{?([A-Za-z])}?', r'\1', s)
    s = re.sub(r'[\\{}]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


# ---------- Author splitting (brace-aware) ----------
def split_authors_raw(s: str):
    out = []
    if not s:
        return out
    cur = []
    depth = 0
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == '{':
            depth += 1
            cur.append(ch)
            i += 1
            continue
        if ch == '}':
            depth = max(0, depth - 1)
            cur.append(ch)
            i += 1
            continue
        # detect " and " at depth 0
        if depth == 0 and s[i:i + 5].lower() == ' and ':
            token = ''.join(cur).strip()
            if token:
                out.append(token)
            cur = []
            i += 5
            continue
        cur.append(ch)
        i += 1
    token = ''.join(cur).strip()
    if token:
        out.append(token)
    return out


def split_name(raw: str):
    t = tex_normalize(raw)
    if not t:
        return {'family': '', 'given': ''}
    if ',' in t:
        parts = [p.strip() for p in t.split(',') if p.strip()]
        family = parts[0]
        given = ', '.join(parts[1:]) if len(parts) > 1 else ''
        return {'family': family, 'given': given}
    toks = [tk for tk in re.split(r'\s+', t) if tk]
    if len(toks) == 1:
        return {'family': toks[0], 'given': ''}
    family = toks[-1]
    given = ' '.join(toks[:-1])
    return {'family': family, 'given': given}


def initials_simple(given: str) -> str:
    if not given:
        return ''
    parts = re.split(r'[\s\-]+', given.strip())
    initials = [p[0].upper() + '.' for p in parts if p]
    return ' '.join(initials)


# ---------- Author parsing with WorldModels-style short names ----------
def parse_authors_field(s: str, long_threshold: int = 3):
    """
    Returns:
      - short: WorldModels-style short form used for popups (Initials Family, etc.)
      - full: full semicolon-separated list for bibliography, with '; et al.' appended if 'others' present
    """
    if not s:
        return {'short': '', 'full': ''}
    parts = split_authors_raw(s)
    parsed = []
    saw_others = False
    for praw in parts:
        p = praw.strip()
        if re.match(r'^(others?(\.|,|\s|$))', p, re.I) or re.match(r'^et\s+al\.?', p, re.I):
            saw_others = True
            continue
        nm = split_name(p)
        if nm['family'] or nm['given']:
            parsed.append(nm)
    # build full list
    full_list = []
    for p in parsed:
        fam = p.get('family', '')
        giv = p.get('given', '')
        if fam and giv:
            full_list.append(f"{fam}, {giv}")
        elif fam:
            full_list.append(fam)
    full = '; '.join(full_list)
    if saw_others:
        full = (full + '; et al.') if full else 'et al.'
    # build world-style short
    families = [x['family'] for x in parsed if x.get('family')]
    givens = [x['given'] for x in parsed]
    n = len(families)

    def world_of_index(i):
        fam = families[i] if i < len(families) else ''
        giv = givens[i] if i < len(givens) else ''
        inits = initials_simple(giv)
        return (inits + ' ' + fam).strip() if (inits or fam) else ''

    if n == 0:
        short = 'et al.' if saw_others else ''
    elif n == 1:
        short = world_of_index(0)
    elif n == 2:
        short = world_of_index(0) + ' & ' + world_of_index(1)
    else:
        # n >= 3
        if n >= long_threshold:
            short = world_of_index(0) + ' et al.'
        else:
            short = ', '.join(world_of_index(i) for i in range(n))
    return {'short': short, 'full': full}


# ---------- Pretty formatting for bibliography ----------
def pretty_from_fields(fields: dict):
    authors_str = fields.get('author', '') or fields.get('editor', '') or ''
    authors = parse_authors_field(authors_str)
    year = fields.get('year', '')
    title = tex_normalize(fields.get('title', ''))
    # prefer journal -> booktitle -> publisher
    venue = tex_normalize(fields.get('journal', '') or fields.get('booktitle', '') or fields.get('publisher', ''))
    vol = fields.get('volume', '')
    pages = fields.get('pages', '') or fields.get('page', '')
    out = ''
    if authors['full']:
        # only add a period if the author string doesn't already end with one
        out += authors['full']
        if not authors['full'].rstrip().endswith('.'):
            out += '. '
        else:
            out += ' '
    if year:
        out += f'({year}). '
    if title:
        out += title + '. '
    vp = ''
    if venue:
        vp += venue
    if vol:
        vp += (', ' if vp else '') + vol
    if pages:
        vp += (', ' if vp else '') + pages
    if vp:
        out += vp + '.'
    # include url if present in fields as another returned property (not embedded into pretty)
    url = (fields.get('url') or fields.get('howpublished') or '').strip()
    return {
        'pretty': out.strip(),
        'shortAuthors': authors['short'],
        'title': title,
        'venue': venue,
        'year': year,
        'url': url
    }


# ---------- HTML escape helper ----------
def attr_escape(s: str) -> str:
    return html.escape(s or '', quote=True)


# ---------- Main conversion function ----------
def bib_to_html(in_path: Path, out_path: Path):
    with open(in_path, 'r', encoding='utf-8') as fh:
        bibtxt = fh.read()

    # Map nonstandard types to misc so parser keeps them
    bibtxt = re.sub(r'@software\s*{', '@misc{', bibtxt, flags=re.I)
    bibtxt = re.sub(r'@online\s*{', '@misc{', bibtxt, flags=re.I)
    bibtxt = re.sub(r'@dataset\s*{', '@misc{', bibtxt, flags=re.I)

    parser = bibtexparser.bparser.BibTexParser(common_strings=True)
    db = bibtexparser.loads(bibtxt, parser=parser)
    items = db.entries

    lines = []
    lines.append('<ol id="refs-list">')

    for entry in items:
        raw_id = entry.get('ID') or entry.get('id') or ''
        norm_id = re.sub(r'[^A-Za-z0-9_\-:]', '', raw_id).lower()

        pf = pretty_from_fields(entry)
        visible = pf['pretty'] or norm_id

        url_raw = pf.get('url', '') or ''
        data_url = attr_escape(url_raw) if url_raw else ''

        venue_norm = (pf.get('venue') or '').strip()
        data_venue_val = '' if re.search(r'arxiv', venue_norm, re.I) else venue_norm

        data_title = attr_escape(pf.get('title', ''))
        data_short = attr_escape(pf.get('shortAuthors', ''))
        data_venue = attr_escape(data_venue_val)
        data_year = attr_escape(pf.get('year', ''))

        visible_html = html.escape(visible)

        li = (f'<li id="ref-{norm_id}" '
              f'data-title="{data_title}" '
              f'data-short-authors="{data_short}" '
              f'data-venue="{data_venue}" '
              f'data-year="{data_year}"')

        if data_url:
            li += f' data-url="{data_url}"'

        li += f'>{visible_html}</li>'

        lines.append(li)

    lines.append('</ol>')
    out_html = '\n'.join(lines)

    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(out_html)

    print(f"Wrote {out_path} ({len(items)} entries)")


# ---------- CLI ----------
def main_cli(argv):
    if len(argv) < 3:
        print("Usage: python3 bib2html.py references.bib bib.html")
        sys.exit(2)
    in_path = Path(argv[1])
    out_path = Path(argv[2])
    if not in_path.exists():
        print("Input file not found:", in_path)
        sys.exit(1)
    bib_to_html(in_path, out_path)


if __name__ == '__main__':
    main_cli(sys.argv)

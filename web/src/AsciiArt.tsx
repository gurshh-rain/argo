const letters = [
  ['  ###  ', ' ## ## ', '##   ##', '##   ##', '#######', '##   ##', '##   ##'],
  ['###### ', '##   ##', '##   ##', '###### ', '## ##  ', '##  ## ', '##   ##'],
  [' ##### ', '##   ##', '##     ', '##  ###', '##   ##', '##   ##', ' ##### '],
  [' ##### ', '##   ##', '##   ##', '##   ##', '##   ##', '##   ##', ' ##### '],
]

const wordmark = Array.from({ length: 7 }, (_, row) => letters.map(letter => letter[row]).join('    ')).join('\n')

export function AsciiWordmark() {
  return <pre className="cv-ascii-wordmark" aria-hidden="true">{wordmark}</pre>
}

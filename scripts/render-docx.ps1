# Render a .docx to PDF with Microsoft Word (hidden), after updating fields (table of contents page numbers).
# Works on a COPY, so the original is never touched. Closes only what it opened: if Word was already running
# (someone is working in it) the script attaches to that instance and does not quit it.
#   powershell -File scripts\render-docx.ps1 -Docx report.docx -Pdf report.pdf [-UpdatedDocx report-updated.docx]
param(
  [Parameter(Mandatory = $true)][string]$Docx,
  [Parameter(Mandatory = $true)][string]$Pdf,
  [string]$UpdatedDocx = ''
)
$ErrorActionPreference = 'Stop'
$src = (Resolve-Path $Docx).Path
$pdfPath = [System.IO.Path]::GetFullPath($Pdf)
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dbim-render-" + [guid]::NewGuid().ToString('N') + '.docx')
Copy-Item $src $tmp
$startedByUs = -not (Get-Process WINWORD -ErrorAction SilentlyContinue)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($tmp, $false, $false, $false)
  foreach ($t in $doc.TablesOfContents) { $t.Update() }
  $null = $doc.Fields.Update()
  foreach ($t in $doc.TablesOfContents) { $t.Update() }   # second pass: page numbers shift once the first pass is done
  $doc.ExportAsFixedFormat($pdfPath, 17)                  # 17 = PDF
  if ($UpdatedDocx) { $doc.SaveAs2([System.IO.Path]::GetFullPath($UpdatedDocx)) }
  "pages: " + $doc.ComputeStatistics(2)
} finally {
  if ($doc) { $doc.Close(0) }
  if ($startedByUs) { $word.Quit() }
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

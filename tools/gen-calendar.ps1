# Генератор календаря «Лето с Машей» (.ics) для импорта в Google Календарь.
# Запуск:  pwsh -NoProfile -File tools/gen-calendar.ps1
$ErrorActionPreference = 'Stop'

$start     = Get-Date '2026-06-01'   # понедельник, старт программы
$totalDays = 84                      # 12 недель * 7 дней
$site      = 'https://masha-eskif.github.io/summer-school/'

$themes = @(
 'Электричество (старт) + Окружность',
 'Цепи + Углы окружности',
 'Закон Ома + Подобие треугольников',
 'Соединения проводников + Площади и средняя линия',
 'Работа и мощность тока + Задачи на движение',
 'Свет: источники, отражение + Задачи на работу/реку',
 'Преломление и линзы + Проценты',
 'Формула линзы, глаз, дисперсия + Сложные проценты',
 'Радиоактивность, ядро + Линейная и квадратичная функция',
 'Ядерные реакции + Графики функций',
 'Распад, изотопы + Вероятность',
 'Итоговое повторение + Статистика'
)

# Экранирование значений по правилам iCalendar (RFC 5545), без regex.
function Esc([string]$s){
  $s.Replace('\','\\').Replace(';','\;').Replace(',','\,').Replace("`r`n",'\n').Replace("`n",'\n')
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('BEGIN:VCALENDAR')
$lines.Add('VERSION:2.0')
$lines.Add('PRODID:-//Лето с Машей//Summer School//RU')
$lines.Add('CALSCALE:GREGORIAN')
$lines.Add('METHOD:PUBLISH')
$lines.Add('X-WR-CALNAME:Лето с Машей — расписание')
$lines.Add('X-WR-CALDESC:Ежедневные напоминания о занятиях (старт 01.06.2026)')

for($i=0; $i -lt $totalDays; $i++){
  $d       = $start.AddDays($i)
  $dow     = [int]$d.DayOfWeek          # Вс=0 ... Сб=6
  $weekNum = [math]::Floor($i/7) + 1
  $theme   = $themes[$weekNum-1]
  $dateStr = $d.ToString('yyyyMMdd')

  switch($dow){
    1 { $sum='📐 Математика';                              $note='День математики. Открой вкладку «Математика»: тема недели + задачи на Решу ОГЭ.';                       $durMin=60 }
    2 { $sum='📝 Русский (полегче)';                       $note='Лёгкий день: одно правило или часть сжатого изложения. Вкладка «Русский».';                            $durMin=40 }
    3 { $sum='⚡ Физика';                                  $note='День физики. Вкладка «Сегодня»: теория, видео и задачи по теме недели.';                                $durMin=60 }
    4 { $sum='💪 Математика + 💻 Информатика (побольше)';  $note='Насыщенный день: сначала математика, потом информатика. Вкладки «Математика» и «Информатика».';         $durMin=90 }
    5 { $sum='📝 Русский + ⛵ Парус';                      $note='Русский (закрепление недели) и приятное — теория паруса. Вкладки «Русский» и «Парус».';                 $durMin=60 }
    6 { $sum='⚡ Физика — выходные (когда будет время)';   $note='Физика в выходные: занимайся когда удобно — сегодня или завтра. Вкладка «Сегодня»: теория и задачи.';   $durMin=60 }
    default { $sum='🌴 Отдых';                             $note='Выходной! Если физику ещё не делала в субботу — самое время сегодня. Сделала — отдыхай 😎';            $durMin=15 }
  }

  $startDt = "${dateStr}T090000"
  $endTime = (Get-Date '09:00').AddMinutes($durMin).ToString('HHmmss')
  $endDt   = "${dateStr}T$endTime"
  $desc    = "Неделя ${weekNum}: $theme`n`n$note`n`nСайт: $site"

  $lines.Add('BEGIN:VEVENT')
  $lines.Add("UID:$dateStr-d$dow@masha-summer-school")
  $lines.Add('DTSTAMP:20260527T000000Z')
  $lines.Add("DTSTART:$startDt")
  $lines.Add("DTEND:$endDt")
  $lines.Add("SUMMARY:$(Esc $sum)")
  $lines.Add("DESCRIPTION:$(Esc $desc)")
  $lines.Add("URL:$site")
  $lines.Add('BEGIN:VALARM')
  $lines.Add('ACTION:DISPLAY')
  $lines.Add('DESCRIPTION:Напоминание о занятии')
  $lines.Add('TRIGGER:-PT0M')          # сработать в момент начала (09:00)
  $lines.Add('END:VALARM')
  $lines.Add('END:VEVENT')
}
$lines.Add('END:VCALENDAR')

$content = ($lines -join "`r`n") + "`r`n"
$path = Join-Path $PSScriptRoot '..\summer-school-calendar.ics'
$path = [System.IO.Path]::GetFullPath($path)
[System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))

$ev = ([regex]::Matches($content,'BEGIN:VEVENT')).Count
Write-Output "Создан файл: $path"
Write-Output "Всего событий: $ev (учебных будней 60, физика на выходных 12, отдых 12)"

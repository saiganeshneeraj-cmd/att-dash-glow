// Pre-loaded college-section timetables. Add more sections here.
export type PresetTimetable = {
  id: string;
  label: string;
  meta?: string;
  periods: string[];
  rows: {
    Mon: string[]; Tue: string[]; Wed: string[]; Thu: string[]; Fri: string[]; Sat: string[];
  };
};

const AIML_PERIODS = [
  "09:00-09:45", "09:45-10:30", "10:30-11:15", "11:15-12:00",
  "01:30-02:15", "02:15-03:00", "03:00-03:45", "03:45-04:30",
];

// Helper: a subject that spans N periods → repeat it N times.
const span = (subject: string, n: number) => Array(n).fill(subject);
const row = (...blocks: [string, number][]) => blocks.flatMap(([s, n]) => span(s, n));

export const PRESETS: PresetTimetable[] = [
  {
    id: "aiml-a-3-4",
    label: "3/4 AIML - Sec A",
    meta: "1st Sem · Room B-402",
    periods: [...AIML_PERIODS],
    rows: {
      Mon: row(["DL LAB", 4], ["NLP LAB", 4]),
      Tue: row(["DL", 2], ["NLP", 2], ["IOT", 2], ["ES(QA)", 2]),
      Wed: row(["OE-I", 2], ["", 2], ["UIDF LAB", 4]),
      Thu: row(["NLP", 2], ["DL", 2], ["CN", 2], ["IOT", 2]),
      Fri: row(["FSD-2 LAB", 4], ["OE-I", 2], ["", 2]),
      Sat: row(["CN", 2], ["ES(VA)", 2], ["", 2], ["", 2]),
    },
  },
  {
    id: "aiml-b-3-4",
    label: "3/4 AIML - Sec B",
    meta: "1st Sem · Room C-202",
    periods: [...AIML_PERIODS],
    rows: {
      Mon: row(["UIDF LAB", 4], ["CN", 2], ["ES(QA)", 2]),
      Tue: row(["NLP LAB", 4], ["NLP", 2], ["ES(VA)", 2]),
      Wed: row(["OE-I", 2], ["", 2], ["DL", 2], ["IOT", 2]),
      Thu: row(["DL LAB", 4], ["FSD-2 LAB", 4]),
      Fri: row(["NLP", 2], ["DL", 2], ["OE-I", 2], ["", 2]),
      Sat: row(["IOT", 2], ["CN", 2], ["", 2], ["", 2]),
    },
  },
  {
    id: "aiml-c-3-4",
    label: "3/4 AIML - Sec C",
    meta: "1st Sem · Room C-204",
    periods: [...AIML_PERIODS],
    rows: {
      Mon: row(["UIDF LAB", 4], ["DL", 2], ["ES(VA)", 2]),
      Tue: row(["DL", 2], ["NLP", 2], ["NLP LAB", 4]),
      Wed: row(["OE-I", 2], ["", 2], ["DL LAB", 4]),
      Thu: row(["CN", 2], ["IOT", 2], ["NLP", 2], ["ES(QA)", 2]),
      Fri: row(["IOT", 2], ["CN", 2], ["OE-I", 2], ["", 2]),
      Sat: row(["FSD-2 LAB", 4], ["", 2], ["", 2]),
    },
  },
  {
    id: "aiml-d-3-4",
    label: "3/4 AIML - Sec D",
    meta: "1st Sem · Room C-201",
    periods: [...AIML_PERIODS],
    rows: {
      Mon: row(["ES(VA)", 2], ["DL", 2], ["NLP", 2], ["CN", 2]),
      Tue: row(["FSD-2 LAB", 4], ["DL", 2], ["ES(QA)", 2]),
      Wed: row(["OE-I", 2], ["", 2], ["UIDF LAB", 4]),
      Thu: row(["NLP", 2], ["IOT", 2], ["NLP LAB", 4]),
      Fri: row(["DL LAB", 4], ["OE-I", 2], ["", 2]),
      Sat: row(["IOT", 2], ["CN", 2], ["", 2], ["", 2]),
    },
  },
];

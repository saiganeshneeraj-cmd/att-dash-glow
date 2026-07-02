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

export const PRESETS: PresetTimetable[] = [
  {
    id: "aiml-c-3-4",
    label: "3/4 AIML - Sec C",
    meta: "1st Semester · Room C-204",
    periods: [...AIML_PERIODS],
    rows: {
      Mon: ["UIDF LAB", "UIDF LAB", "UIDF LAB", "UIDF LAB", "DL", "DL", "ES(VA)", "ES(VA)"],
      Tue: ["DL", "DL", "NLP", "NLP", "NLP LAB", "NLP LAB", "NLP LAB", "NLP LAB"],
      Wed: ["OE-I", "OE-I", "Minors", "Minors", "DL LAB", "DL LAB", "DL LAB", "DL LAB"],
      Thu: ["CN", "CN", "IOT", "IOT", "NLP", "NLP", "ES(QA)", "ES(QA)"],
      Fri: ["IOT", "IOT", "CN", "CN", "OE-I", "OE-I", "Minors", "Minors"],
      Sat: ["FSD-2 LAB", "FSD-2 LAB", "FSD-2 LAB", "FSD-2 LAB", "", "", "", ""],
    },
  },
];

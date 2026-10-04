"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * The watch finder.
 *
 * Five questions, any of which may be skipped, and a count that moves as they
 * are answered. The count is the point: a filter panel that says nothing until
 * you commit to it teaches you nothing, whereas watching 1,899 fall to 23 tells
 * you immediately whether you have asked for something the shop actually has.
 *
 * To do that without a round trip, the page hands down one compact row per
 * watch — five short fields and a price — rather than the catalogue. At about
 * 1,900 rows that is a few tens of kilobytes, and every answer is then counted
 * in the browser in a single pass.
 *
 * The finder does not display watches. It hands the answers to the collection,
 * which already knows how to filter, sort, paginate and be linked to. One
 * filtering implementation, not two.
 */

/** gender, type, movement, strap, brand slug, selling price (0 when unpriced). */
export type FinderRow = [string, string, string, string, string, number];

export interface FinderOption {
  value: string;
  label: string;
}

export interface FinderQuestion {
  /** The query key the collection reads. */
  key: "gender" | "collection" | "movement" | "strap";
  /** Which slot of a row this reads. */
  slot: 0 | 1 | 2 | 3;
  question: string;
  options: FinderOption[];
}

export interface Band {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}

type Answers = Partial<Record<string, string>>;

export default function WatchFinder({
  rows,
  questions,
  bands,
}: {
  rows: FinderRow[];
  questions: FinderQuestion[];
  bands: Band[];
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [band, setBand] = useState<Band | null>(null);

  const matches = useMemo(() => {
    return rows.filter((row) => {
      for (const question of questions) {
        const wanted = answers[question.key];
        if (wanted && row[question.slot] !== wanted) return false;
      }
      if (band) {
        const price = row[5];
        // An unpriced piece — price on request — cannot answer a budget.
        if (!price) return false;
        if (band.min !== null && price < band.min) return false;
        if (band.max !== null && price > band.max) return false;
      }
      return true;
    }).length;
  }, [rows, questions, answers, band]);

  const chosen = Object.values(answers).filter(Boolean).length + (band ? 1 : 0);

  const href = useMemo(() => {
    const query = new URLSearchParams();
    for (const question of questions) {
      const value = answers[question.key];
      if (value) query.set(question.key, value);
    }
    if (band?.min !== null && band?.min !== undefined) query.set("min", String(band.min));
    if (band?.max !== null && band?.max !== undefined) query.set("max", String(band.max));
    const search = query.toString();
    return search ? `/collections?${search}` : "/collections";
  }, [answers, band, questions]);

  const pick = (key: string, value: string) =>
    setAnswers((current) => ({ ...current, [key]: current[key] === value ? undefined : value }));

  return (
    <div className="finder">
      <div className="finder-questions">
        {questions.map((question, index) => (
          <fieldset key={question.key} className="finder-step">
            <legend>
              <span className="mono finder-no">{String(index + 1).padStart(2, "0")}</span>
              <span className="serif finder-ask">{question.question}</span>
            </legend>
            <div className="finder-choices">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="finder-chip"
                  aria-pressed={answers[question.key] === option.value}
                  onClick={() => pick(question.key, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="finder-step">
          <legend>
            <span className="mono finder-no">{String(questions.length + 1).padStart(2, "0")}</span>
            <span className="serif finder-ask">What are you spending?</span>
          </legend>
          <div className="finder-choices">
            {bands.map((option) => (
              <button
                key={option.id}
                type="button"
                className="finder-chip"
                aria-pressed={band?.id === option.id}
                onClick={() => setBand((current) => (current?.id === option.id ? null : option))}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <aside className="finder-result">
        <div className="finder-count serif">{matches}</div>
        <p className="finder-count-label">
          {matches === 1 ? "watch in stock matches" : "watches in stock match"}
          {chosen === 0 ? " — answer anything above to narrow it" : ""}
        </p>

        {matches > 0 ? (
          <Link href={href} className="btn btn-solid finder-go">
            See {matches === 1 ? "it" : "them"}
          </Link>
        ) : (
          <p className="finder-none">
            Nothing in the window matches all of that. Loosen a question — or call{" "}
            <a href="tel:+919899645897">+91 98996 45897</a> and we will source it.
          </p>
        )}

        {chosen > 0 && (
          <button
            type="button"
            className="finder-clear mono"
            onClick={() => {
              setAnswers({});
              setBand(null);
            }}
          >
            Start again
          </button>
        )}
      </aside>
    </div>
  );
}

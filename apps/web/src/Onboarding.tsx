import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Profile } from "@exem/shared";
import { TEAM_MEMBERS } from "./data";

export function OnboardingScreen({ onStart }: { onStart: (profile: Profile) => void }) {
  const [dept, setDept] = useState("FE1팀");
  const [name, setName] = useState("");
  const ready = dept.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="app-shell onboarding-shell">
      <main className="main-screen">
        <section className="step">
          <p className="eyeline" style={{ color: "var(--blue)", fontSize: 13, fontWeight: 800, margin: 0 }}>
            처음이세요?
          </p>
          <h2 className="step-title">어디 팀, 누구신가요?</h2>
          <p className="step-sub">이 기기에만 저장돼요.</p>

          <div className="step-body">
            <div className="field">
              <span className="field-label">부서</span>
              <input
                className="field-input"
                placeholder="예: FE1팀"
                value={dept}
                onChange={(event) => setDept(event.target.value)}
              />
            </div>

            <div className="field">
              <span className="field-label">이름</span>
              {TEAM_MEMBERS.length > 0 ? (
                <div className="member-toggles" style={{ marginBottom: 8 }}>
                  {TEAM_MEMBERS.map((member) => (
                    <button
                      key={member}
                      type="button"
                      className={name === member ? "member-toggle active" : "member-toggle"}
                      onClick={() => setName(member)}
                    >
                      {member}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                className="field-input"
                placeholder="목록에 없으면 직접 입력"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="notice neutral">
              <ShieldCheck size={16} aria-hidden="true" />
              카드 정보는 서버를 거치지 않아요.
            </div>
          </div>

          <div className="bottom-bar">
            <div className="inner">
              <button
                type="button"
                className="primary-button full"
                disabled={!ready}
                onClick={() => onStart({ dept: dept.trim(), name: name.trim() })}
              >
                시작
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

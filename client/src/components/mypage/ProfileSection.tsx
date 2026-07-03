import { useAuth } from "@/_core/hooks/useAuth";
import { NATIONALITIES } from "@shared/const";
import { getFirebaseDb } from "@/lib/firebase";
import { useTranslation } from "react-i18next";
import { doc, updateDoc } from "firebase/firestore";
import { useState, useEffect } from "react";

export function ProfileSection() {
  const { t } = useTranslation();
  // useAuth の user は Firestore users/{uid} の onSnapshot で常に最新。
  // getProfile tRPC は不要になった。
  const { user } = useAuth();
  // BaaSネイティブ: userUpdateProfile Callable を廃止し Firestore 直接 updateDoc に移行
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [nationality, setNationality] = useState("");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");

  // user が更新されたとき（onSnapshot 経由）にフォームを同期する
  useEffect(() => {
    if (user) {
      setFullName(user.fullName ?? "");
      setNationality(user.nationality ?? "");
      setAge(user.age ? String(user.age) : "");
      setPhone(user.phoneNumber ?? "");
    }
  }, [user]);

  const handleSave = async () => {
    setError(null);
    const ageNum = age ? parseInt(age, 10) : undefined;
    if (ageNum !== undefined && (isNaN(ageNum) || ageNum < 1 || ageNum > 120)) {
      setError("Please enter a valid age."); return;
    }
    if (!user?.uid) { setError("Not authenticated."); return; }
    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      if (fullName.trim()) updates.fullName = fullName.trim();
      if (nationality) updates.nationality = nationality;
      if (ageNum !== undefined) updates.age = ageNum;
      if (phone.trim()) updates.phoneNumber = phone.trim();
      await updateDoc(doc(getFirebaseDb(), "users", user.uid), updates);
      setEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setError(t("common.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const nationalityName = NATIONALITIES.find(n => n.code === (user?.nationality ?? nationality))?.name;

  return (
    <div className="border-t border-[#E8E8E8] pt-10 mt-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-label text-black/30 mb-1">PROFILE</p>
          <h2 className="font-sans font-light text-black text-[1.25rem] tracking-[-0.02em]">Your information.</h2>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-label text-[0.7rem] px-4 py-2 border border-[#D7D7D7] text-black hover:border-black transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {saveSuccess && (
        <div className="border border-black/10 bg-black/5 px-4 py-3 mb-5">
          <p className="font-sans text-black/70 text-[0.8125rem]">Profile updated successfully.</p>
        </div>
      )}

      {/* ログイン中のメールアドレス（Google アカウント / 編集不可） */}
      <div className="bg-white border border-[#E8E8E8] p-5 mb-px">
        <p className="text-label text-black/35 mb-1.5">Email <span className="text-black/25 normal-case tracking-normal">(Google account · read-only)</span></p>
        <p className="font-sans text-black text-[0.9rem] break-all">{user?.email || "—"}</p>
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 gap-px bg-[#E8E8E8]">
          {[
            { label: "Full Name", value: user?.fullName || "—" },
            { label: "Nationality", value: nationalityName || "—" },
            { label: "Age", value: user?.age ? `${user.age} years old` : "—" },
            { label: "Phone", value: user?.phoneNumber || "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white p-5">
              <p className="text-label text-black/35 mb-1.5">{label}</p>
              <p className="font-sans text-black text-[0.9rem]">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="text-label text-black/50 block mb-2">Email <span className="text-black/30">(read-only)</span></label>
            <input type="email" value={user?.email || ""} disabled readOnly
              className="font-sans w-full border border-[#E8E8E8] bg-[#F7F7F7] px-4 py-3 text-[0.9rem] text-black/50 cursor-not-allowed" />
          </div>
          <div>
            <label className="text-label text-black/50 block mb-2">Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="As shown on your passport"
              className="font-sans w-full border border-[#D7D7D7] px-4 py-3 text-[0.9rem] text-black placeholder:text-black/25 focus:outline-none focus:border-black transition-colors" />
          </div>
          <div>
            <label className="text-label text-black/50 block mb-2">Nationality</label>
            <select value={nationality} onChange={e => setNationality(e.target.value)}
              className="font-sans w-full border border-[#D7D7D7] px-4 py-3 text-[0.9rem] text-black bg-white focus:outline-none focus:border-black transition-colors appearance-none">
              <option value="">Select nationality</option>
              {NATIONALITIES.map(n => <option key={n.code} value={n.code}>{n.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-label text-black/50 block mb-2">Age</label>
            <input type="number" value={age} onChange={e => setAge(e.target.value)}
              placeholder="e.g. 28" min={1} max={120}
              className="font-sans w-full border border-[#D7D7D7] px-4 py-3 text-[0.9rem] text-black placeholder:text-black/25 focus:outline-none focus:border-black transition-colors" />
          </div>
          <div>
            <label className="text-label text-black/50 block mb-2">Phone Number <span className="text-black/30">(optional)</span></label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="e.g. +1 234 567 8900"
              className="font-sans w-full border border-[#D7D7D7] px-4 py-3 text-[0.9rem] text-black placeholder:text-black/25 focus:outline-none focus:border-black transition-colors" />
          </div>
          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3">
              <p className="font-sans text-red-700 text-[0.8125rem]">{error}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setEditing(false); setError(null); }}
              className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={isSaving}
              className="text-label flex-1 py-3.5 bg-black text-white hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2">
              {isSaving ? <><span className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />Saving...</> : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StopNoteProps {
  note?: string | null;
  label?: string | null;
  className?: string;
}

export function visibleStopNote(note?: string | null, label?: string | null) {
  const normalizedNote = note?.trim();
  if (!normalizedNote) return null;
  if (normalizedNote.localeCompare(label?.trim() ?? '', undefined, { sensitivity: 'accent' }) === 0) {
    return null;
  }
  return normalizedNote;
}

export function StopNote({ note, label, className = '' }: StopNoteProps) {
  const visibleNote = visibleStopNote(note, label);
  if (!visibleNote) return null;

  return (
    <p className={`min-w-0 max-w-full break-words text-pretty ${className}`}>
      {visibleNote}
    </p>
  );
}
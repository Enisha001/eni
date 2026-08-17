// @group PersonaSelector : Compact chip selector for AI personas
import { BUILT_IN_PERSONAS } from '../store';

interface PersonaSelectorProps {
  activePersonaId: string | null;
  onSelect: (id: string) => void;
  darkMode: boolean;
}

// @group PersonaSelector : Render persona chips in a horizontal row
export default function PersonaSelector({ activePersonaId, onSelect, darkMode }: PersonaSelectorProps) {
  const active = activePersonaId ?? 'default';

  return (
    <div className="flex flex-wrap gap-1.5">
      {BUILT_IN_PERSONAS.map(persona => (
        <button
          key={persona.id}
          onClick={() => onSelect(persona.id)}
          title={persona.description}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            active === persona.id
              ? 'bg-[#7c2d3a] text-white shadow-sm shadow-[#7c2d3a]/30'
              : darkMode
                ? 'bg-[#2d1d24] text-gray-300 hover:bg-[#3a1d27] hover:text-[#f7dce3]'
                : 'bg-[#f8edf0] text-[#7f5863] hover:bg-[#f1dfe5] hover:text-[#5b1f2e]'
          }`}
        >
          {persona.name}
        </button>
      ))}
    </div>
  );
}

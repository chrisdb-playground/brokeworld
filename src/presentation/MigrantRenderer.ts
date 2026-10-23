import type { MigrantAvatarSpec, MigrantState } from '../sim/types';

export class MigrantRenderer {
  /**
   * Generates a Prison Architect style character SVG
   * Dimensions: 80x100 (or scaled viewBox)
   */
  static generateSvg(
    migrant: { name?: string; avatar: MigrantAvatarSpec; status?: string; recruitedByGangId?: string },
    size = 90
  ): string {
    const { skinTone, shirtColor, eyesType, mouthType, hairColor, hairStyle, luggage } = migrant.avatar;

    // Head eyes variations
    let eyesSvg = '';
    if (eyesType === 'sleepy') {
      eyesSvg = `
        <line x1="33" y1="36" x2="39" y2="36" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" />
        <line x1="45" y1="36" x2="51" y2="36" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" />
      `;
    } else if (eyesType === 'wide') {
      eyesSvg = `
        <circle cx="36" cy="35" r="4.5" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" />
        <circle cx="36" cy="35" r="2" fill="#0f172a" />
        <circle cx="48" cy="35" r="4.5" fill="#ffffff" stroke="#0f172a" stroke-width="1.5" />
        <circle cx="48" cy="35" r="2" fill="#0f172a" />
      `;
    } else if (eyesType === 'winking') {
      eyesSvg = `
        <circle cx="36" cy="36" r="2.5" fill="#0f172a" />
        <path d="M 45 36 Q 48 33 51 36" stroke="#0f172a" stroke-width="2.5" fill="none" stroke-linecap="round" />
      `;
    } else {
      // Classic Prison Architect dot eyes
      eyesSvg = `
        <circle cx="36" cy="36" r="2.8" fill="#0f172a" />
        <circle cx="48" cy="36" r="2.8" fill="#0f172a" />
      `;
    }

    // Mouth
    let mouthSvg = '';
    if (mouthType === 'open') {
      mouthSvg = `<ellipse cx="42" cy="45" rx="3.5" ry="4.5" fill="#b91c1c" stroke="#0f172a" stroke-width="1.2" />`;
    } else if (mouthType === 'frown') {
      mouthSvg = `<path d="M 38 46 Q 42 42 46 46" stroke="#0f172a" stroke-width="2" fill="none" stroke-linecap="round" />`;
    } else if (mouthType === 'neutral') {
      mouthSvg = `<line x1="38" y1="44" x2="46" y2="44" stroke="#0f172a" stroke-width="2" stroke-linecap="round" />`;
    } else {
      mouthSvg = `<path d="M 37 43 Q 42 47 47 43" stroke="#0f172a" stroke-width="2" fill="none" stroke-linecap="round" />`;
    }

    // Hair / Headgear
    let hairSvg = '';
    if (hairStyle === 'curly') {
      hairSvg = `
        <circle cx="32" cy="22" r="7" fill="${hairColor}" />
        <circle cx="42" cy="20" r="8" fill="${hairColor}" />
        <circle cx="52" cy="22" r="7" fill="${hairColor}" />
      `;
    } else if (hairStyle === 'short') {
      hairSvg = `<path d="M 27 28 C 27 16 57 16 57 28 Z" fill="${hairColor}" />`;
    } else if (hairStyle === 'beanie') {
      hairSvg = `
        <path d="M 26 28 C 26 14 58 14 58 28 Z" fill="#475569" stroke="#0f172a" stroke-width="1.5" />
        <rect x="25" y="26" width="34" height="6" rx="3" fill="#334155" />
      `;
    }

    // Luggage
    let luggageSvg = '';
    if (luggage === 'briefcase') {
      luggageSvg = `
        <g transform="translate(62, 60)">
          <rect x="0" y="4" width="16" height="12" rx="2" fill="#78350f" stroke="#0f172a" stroke-width="1.5" />
          <path d="M 5 4 L 5 1 L 11 1 L 11 4" stroke="#0f172a" stroke-width="1.5" fill="none" />
          <line x1="8" y1="7" x2="8" y2="13" stroke="#facc15" stroke-width="1.5" />
        </g>
      `;
    } else if (luggage === 'backpack') {
      luggageSvg = `
        <g transform="translate(8, 55)">
          <rect x="0" y="0" width="14" height="20" rx="4" fill="#047857" stroke="#0f172a" stroke-width="1.5" />
          <rect x="3" y="4" width="8" height="6" rx="1.5" fill="#065f46" />
        </g>
      `;
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 96" width="${size}" height="${(size * 96) / 84}" class="migrant-avatar-svg">
        <defs>
          <radialGradient id="grad-head" cx="40%" cy="35%" r="60%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.15" />
          </radialGradient>
        </defs>

        <!-- Shadow under character -->
        <ellipse cx="42" cy="90" rx="24" ry="5.5" fill="#000000" opacity="0.25" />

        <!-- Prison Architect Pill / Bean Body -->
        <g id="body">
          <!-- Torso Pill -->
          <rect x="22" y="46" width="40" height="40" rx="18" fill="${shirtColor}" stroke="#0f172a" stroke-width="2.5" />
          <!-- Central Jumpsuit Seam / Zipper -->
          <line x1="42" y1="52" x2="42" y2="82" stroke="#0f172a" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6" />
          <circle cx="42" cy="54" r="1.8" fill="#cbd5e1" />
          <!-- Collar -->
          <path d="M 36 47 L 42 54 L 48 47" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" />
        </g>

        <!-- Prison Architect Floating Hands (Little rounded nubs) -->
        <circle cx="17" cy="66" r="6" fill="${skinTone}" stroke="#0f172a" stroke-width="2" />
        <circle cx="67" cy="66" r="6" fill="${skinTone}" stroke="#0f172a" stroke-width="2" />

        <!-- Optional Luggage -->
        ${luggageSvg}

        <!-- Prison Architect Round Head -->
        <g id="head">
          <circle cx="42" cy="34" r="19" fill="${skinTone}" stroke="#0f172a" stroke-width="2.5" />
          <circle cx="42" cy="34" r="19" fill="url(#grad-head)" />

          <!-- Cute Nose -->
          <circle cx="42" cy="39" r="1.5" fill="#0f172a" opacity="0.6" />

          <!-- Eyes -->
          ${eyesSvg}

          <!-- Mouth -->
          ${mouthSvg}

          <!-- Hair / Beanie -->
          ${hairSvg}
        </g>
      </svg>
    `.trim();
  }

  /**
   * Generates a miniature passenger badge for vehicle overlays
   */
  static generateBadgeSvg(migrant: MigrantState): string {
    return `
      <div class="migrant-mini-token" title="${migrant.name} (Destination: The West)">
        ${this.generateSvg(migrant, 28)}
      </div>
    `;
  }
}

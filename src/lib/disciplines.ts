/** The fixed list of disciplines ("Crafts"). Every entry has exactly one; the editor offers these as a dropdown. */
export const DISCIPLINES = {
  tech: { name: 'Tech', blurb: 'Code, tools and the machinery behind the walls.', ink: '#3f5f73' },
  art: { name: 'Art', blurb: 'Models, textures, light and everything you can see.', ink: '#8a4530' },
  design: { name: 'Design', blurb: 'Puzzles, rooms and the rules that hold them together.', ink: '#4d6657' },
  audio: { name: 'Audio', blurb: 'Music, sound and the noises the house makes.', ink: '#6b4a6e' },
  narrative: { name: 'Narrative', blurb: 'The family, their story and how it is told.', ink: '#7a5c18' },
  production: { name: 'Production', blurb: 'Plans, milestones and how the team works.', ink: '#4a4a52' },
} as const;

export type Discipline = keyof typeof DISCIPLINES;
export const DISCIPLINE_KEYS = Object.keys(DISCIPLINES) as [Discipline, ...Discipline[]];

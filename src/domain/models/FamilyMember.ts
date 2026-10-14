/** Proche enregistré (importé des contacts ou saisi) : ses envois MoMo sont classés « Famille ». */
export interface FamilyMember {
  id: string;
  name: string;
  phone?: string;
  /** Lien de parenté facultatif (Maman, Tonton…). */
  relation?: string;
}

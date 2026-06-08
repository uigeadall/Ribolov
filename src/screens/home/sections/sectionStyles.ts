import { StyleSheet } from 'react-native';
import { radius, spacing } from '../../../theme/typography';

/** Style keys shared by 2+ home sections, moved verbatim out of HomeScreen's
    local `S` so the extracted section components don't each copy them. */
export const sectionStyles = StyleSheet.create({
  // Section headers (accent bar + label + optional right link)
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2 },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Nunito_700Bold',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  sectionLink: { fontSize: 12, fontFamily: 'Nunito_700Bold' },

  // Empty-section hint pressable
  emptyHint: {
    marginHorizontal: spacing.xl, marginBottom: spacing.xl,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1, borderStyle: 'dashed',
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
  },
  emptyHintIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyHintText: { flex: 1, fontSize: 12, fontFamily: 'Nunito_600SemiBold' },

  // Horizontal catch tiles (this-day / following / recent rails)
  catchCard: {
    width: 120, height: 160, borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  catchEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sm,
  },
});

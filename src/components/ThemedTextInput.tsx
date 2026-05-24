import React from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../services/themeContext';

/**
 * Drop-in replacement for `<TextInput>` that auto-injects theme-aware
 * caret + selection colors. Without these, Android defaults to Holo blue,
 * which is invisible against dark-theme surfaces and clashes with the
 * app's ocean-blue accent.
 *
 * Callers can still pass `selectionColor` / `cursorColor` explicitly to
 * override per-input.
 */
export function ThemedTextInput(props: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      selectionColor={props.selectionColor ?? colors.primary + '55'}
      cursorColor={props.cursorColor ?? colors.primary}
      {...props}
    />
  );
}

import React, { Component, ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { lightColors } from '../theme/palette';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { captureException } from '../services/observability';
import { ThemeContext } from '../services/themeContext';

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; info: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    this.setState({ info: info.componentStack ?? null });
    captureException(error, {
      area: 'react_error_boundary',
      screen: this.props.label ?? 'unknown',
    });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children as any;
    const { error, info } = this.state;
    const { label } = this.props;
    return (
      <ThemeContext.Consumer>
        {(theme) => (
          <ErrorUI
            error={error}
            info={info}
            label={label}
            colors={theme?.colors ?? lightColors}
          />
        )}
      </ThemeContext.Consumer>
    );
  }
}

function ErrorUI({
  error,
  info,
  label,
  colors,
}: {
  error: Error;
  info: string | null;
  label?: string;
  colors: AppColors;
}) {
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        Грешка{label ? ` в „${label}"` : ''}
      </Text>
      <Text style={styles.msg}>{error.message || String(error)}</Text>
      {__DEV__ ? (
        <ScrollView style={styles.stackBox} contentContainerStyle={{ padding: spacing.md }}>
          <Text style={styles.stack}>{error.stack}</Text>
          {info ? <Text style={styles.stack}>{info}</Text> : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
    title: { ...typography.h2, color: colors.danger, marginTop: spacing.xl },
    msg: { ...typography.body, color: colors.text, marginTop: spacing.md },
    stackBox: { flex: 1, backgroundColor: '#0E2230', borderRadius: 8, marginTop: spacing.lg },
    stack: { color: '#9DD0E0', fontFamily: 'Courier', fontSize: 11, lineHeight: 16 },
  });
}

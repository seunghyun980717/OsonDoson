import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/lib/theme';

type Props = {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export const PageLayout = ({ header, footer, children }: Props) => (
  <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
    {header && <View style={styles.header}>{header}</View>}
    <View style={styles.body}>{children}</View>
    {footer && <View style={styles.footer}>{footer}</View>}
  </SafeAreaView>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface.page,
  },
  header: {
    paddingHorizontal: spacing[5],
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[5],
  },
  footer: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
});

import { useTheme } from '@shopify/restyle';
import React, { useState } from 'react';

import NotificationItem from '@/src/components/profile/NotificationItem';
import SheetHeader from '@/src/components/profile/SheetHeader';
import BottomSheet from '@/src/components/shared/BottomSheet';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const NotificationSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();

  const [transactionNotifs, setTransactionNotifs] = useState(true);
  const [securityAlerts, setSecurityAlerts] = useState(true);
  const [appUpdates, setAppUpdates] = useState(false);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      scrollable
      backgroundStyle={{
        backgroundColor: isDark ? theme.colors.cardbg : theme.colors.mainBackground,
      }}
      header={<SheetHeader title="Notifications" onBack={onClose} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}
    >
      <NotificationItem
        title="Transaction Notifications"
        description="Get notified about incoming and outgoing transactions"
        value={transactionNotifs}
        onValueChange={setTransactionNotifs}
      />
      <NotificationItem
        title="Security Alerts"
        description="Important security updates and warnings"
        value={securityAlerts}
        onValueChange={setSecurityAlerts}
      />
      <NotificationItem
        title="App Updates"
        description="New features and product announcements"
        value={appUpdates}
        onValueChange={setAppUpdates}
      />
    </BottomSheet>
  );
};

export default NotificationSheet;

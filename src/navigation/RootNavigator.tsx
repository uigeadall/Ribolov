import React, { useMemo, useState } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  type LinkingOptions,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../services/themeContext';
import { AppTabBar } from './AppTabBar';
import {
  FeedStackParamList,
  LogbookStackParamList,
  ProfileStackParamList,
  RootStackParamList,
  SpeciesStackParamList,
  TabsParamList,
} from './types';
import { useNotificationNavigation } from '../hooks/useNotificationNavigation';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import { useUnreadMessagesCount } from '../hooks/useUnreadMessagesCount';
import { useAuth } from '../services/authContext';
import AsyncStorage from '../storage/kv';
import * as Location from 'expo-location';
import { catchesStore } from '../storage/storage';

// Eagerly-loaded screens — first-paint path or hot navigation targets.
// Everything else uses `getComponent` lower down for code-splitting via
// Metro's lazy-require handling.
import HomeScreen from '../screens/HomeScreen';
import LogbookScreen from '../screens/LogbookScreen';
import AddCatchScreen from '../screens/AddCatchScreen';
import CatchDetailScreen from '../screens/CatchDetailScreen';
import PostDetailScreen from '../screens/PostDetailScreen';
import MapScreen from '../screens/MapScreen';
import SpeciesScreen from '../screens/SpeciesScreen';
import SpeciesDetailScreen from '../screens/SpeciesDetailScreen';
import GearScreen from '../screens/GearScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AuthScreen from '../screens/AuthScreen';
import FeedScreen from '../screens/FeedScreen';
import FriendsScreen from '../screens/FriendsScreen';
import ClassicsScreen from '../screens/ClassicsScreen';
import ChatsScreen from '../screens/ChatsScreen';
import ChatDetailScreen from '../screens/ChatDetailScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import UserPublicProfileScreen from '../screens/UserPublicProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SavedPostsScreen from '../screens/SavedPostsScreen';
import { ErrorBoundary } from '../components/ErrorBoundary';

const wrap = (label: string, Component: React.ComponentType<any>) => (props: any) =>
  (
    <ErrorBoundary label={label}>
      <Component {...props} />
    </ErrorBoundary>
  );

const HomeScreenWrapped = wrap('Начало', HomeScreen);
const MapScreenWrapped = wrap('Карта', MapScreen);
const AuthScreenWrapped = wrap('Вход', AuthScreen);
const FeedScreenWrapped = wrap('Feed', FeedScreen);
const FriendsScreenWrapped = wrap('Приятели', FriendsScreen);
const LeaderboardScreenWrapped = wrap('Класирания', LeaderboardScreen);
const ClassicsScreenWrapped = wrap('Класики', ClassicsScreen);
const UserPublicProfileWrapped = wrap('Профил на рибар', UserPublicProfileScreen);
const NotificationsWrapped = wrap('Известия', NotificationsScreen);
const SavedPostsWrapped = wrap('Запазени', SavedPostsScreen);

const Tabs = createBottomTabNavigator<TabsParamList>();
const LogbookStack = createNativeStackNavigator<LogbookStackParamList>();
const FeedStack = createNativeStackNavigator<FeedStackParamList>();
const SpeciesStack = createNativeStackNavigator<SpeciesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function LogbookNavigator() {
  return (
    <ErrorBoundary label="Дневник">
      <LogbookStack.Navigator screenOptions={{ headerShown: false }}>
        <LogbookStack.Screen name="LogbookList" component={LogbookScreen} />
        <LogbookStack.Screen name="AddCatch" component={AddCatchScreen} />
        <LogbookStack.Screen name="CatchDetail" component={CatchDetailScreen} />
        <LogbookStack.Screen name="PhotoGallery" getComponent={() => require('../screens/PhotoGalleryScreen').default} />
      </LogbookStack.Navigator>
    </ErrorBoundary>
  );
}

function SpeciesNavigator() {
  return (
    <ErrorBoundary label="Видове">
      <SpeciesStack.Navigator screenOptions={{ headerShown: false }}>
        <SpeciesStack.Screen name="SpeciesList" component={SpeciesScreen} />
        <SpeciesStack.Screen name="SpeciesDetail" component={SpeciesDetailScreen} />
        <SpeciesStack.Screen name="SpeciesTarget" getComponent={() => require('../screens/SpeciesTargetScreen').default} />
        <SpeciesStack.Screen name="Regulations" getComponent={() => require('../screens/RegulationsScreen').default} />
        <SpeciesStack.Screen name="Gear" component={GearScreen} />
        <SpeciesStack.Screen name="Knots" getComponent={() => require('../screens/KnotsScreen').default} />
        <SpeciesStack.Screen name="KnotDetail" getComponent={() => require('../screens/KnotDetailScreen').default} />
        <SpeciesStack.Screen name="WeightCalc" getComponent={() => require('../screens/WeightCalcScreen').default} />
      </SpeciesStack.Navigator>
    </ErrorBoundary>
  );
}

function FeedNavigator() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedList" component={FeedScreenWrapped} />
      <FeedStack.Screen name="CatchDetail" component={CatchDetailScreen} />
      <FeedStack.Screen name="PostDetail" component={PostDetailScreen} />
      <FeedStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <FeedStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <FeedStack.Screen name="Notifications" component={NotificationsWrapped} />
      <FeedStack.Screen name="Auth" component={AuthScreenWrapped} />
      <FeedStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <FeedStack.Screen name="Explore" getComponent={() => require('../screens/ExploreScreen').default} />
      <FeedStack.Screen name="CreatePost" getComponent={() => require('../screens/CreatePostScreen').default} />
      <FeedStack.Screen name="HashtagFeed" getComponent={() => require('../screens/HashtagFeedScreen').default} />
    </FeedStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ErrorBoundary label="Профил">
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="CatchDetail" component={CatchDetailScreen} />
      <ProfileStack.Screen name="Notifications" component={NotificationsWrapped} />
      <ProfileStack.Screen name="Stats" getComponent={() => require('../screens/StatsScreen').default} />
      <ProfileStack.Screen name="Auth" component={AuthScreenWrapped} />
      <ProfileStack.Screen name="Feed" component={FeedScreenWrapped} />
      <ProfileStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <ProfileStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <ProfileStack.Screen name="Tournaments" getComponent={() => require('../screens/TournamentsScreen').default} />
      <ProfileStack.Screen name="TournamentDetail" getComponent={() => require('../screens/TournamentDetailScreen').default} />
      <ProfileStack.Screen name="CreateTournament" getComponent={() => require('../screens/CreateTournamentScreen').default} />
      <ProfileStack.Screen name="Achievements" getComponent={() => require('../screens/AchievementsScreen').default} />
      <ProfileStack.Screen name="Trips" getComponent={() => require('../screens/TripsScreen').default} />
      <ProfileStack.Screen name="TripDetail" getComponent={() => require('../screens/TripDetailScreen').default} />
      <ProfileStack.Screen name="TripPlanner" getComponent={() => require('../screens/TripPlannerScreen').default} />
      <ProfileStack.Screen name="Insights" getComponent={() => require('../screens/InsightsScreen').default} />
      <ProfileStack.Screen name="Leaderboard" component={LeaderboardScreenWrapped} />
      <ProfileStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <ProfileStack.Screen name="Chats" component={ChatsScreen} />
      <ProfileStack.Screen name="ChatDetail" component={ChatDetailScreen} />
      <ProfileStack.Screen name="LegalInfo" getComponent={() => require('../screens/LegalInfoScreen').default} />
      <ProfileStack.Screen name="Species" component={SpeciesNavigator} />
      <ProfileStack.Screen name="PersonalBests" getComponent={() => require('../screens/PersonalBestsScreen').default} />
      <ProfileStack.Screen name="Groups" getComponent={() => require('../screens/GroupsScreen').default} />
      <ProfileStack.Screen name="GroupDetail" getComponent={() => require('../screens/GroupDetailScreen').default} />
      <ProfileStack.Screen name="CreateGroup" getComponent={() => require('../screens/CreateGroupScreen').default} />
      <ProfileStack.Screen name="CreateGroupEvent" getComponent={() => require('../screens/CreateGroupEventScreen').default} />
      <ProfileStack.Screen name="CreateGroupPoll" getComponent={() => require('../screens/CreateGroupPollScreen').default} />
      <ProfileStack.Screen name="NotificationPreferences" getComponent={() => require('../screens/NotificationPreferencesScreen').default} />
      <ProfileStack.Screen name="AppIconPicker" getComponent={() => require('../screens/AppIconPickerScreen').default} />
    </ProfileStack.Navigator>
    </ErrorBoundary>
  );
}

function TabNavigator() {
  const { user } = useAuth();
  const unreadNotifs = useUnreadNotifCount(user?.uid);
  const unreadMsgs = useUnreadMessagesCount(user?.uid);
  // Combined Profile-tab badge — DMs + notifications. Both live behind
  // ProfileTab so two separate badges on the same icon would clutter; the
  // combined number tells the user "you have N things waiting in Profile"
  // and the Profile hero already breaks down which is which.
  const profileBadge = unreadNotifs + unreadMsgs;
  const [feedBadge, setFeedBadge] = React.useState<string | undefined>(undefined);
  const [mapBadge, setMapBadge] = React.useState<string | undefined>(undefined);

  // Track the highest nearby-count the user has already seen, so we only badge
  // when there are NEW nearby catches — not on every cold start with the same
  // count (which read as a misleading "unread" indicator).
  const nearbyCountRef = React.useRef<number>(0);
  React.useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const catches = await catchesStore.list();
        const nearby = catches.filter((c) => {
          if (!c.location?.latitude || !c.location?.longitude) return false;
          const dlat = c.location.latitude - loc.coords.latitude;
          const dlng = c.location.longitude - loc.coords.longitude;
          const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
          return dist < 50;
        });
        const currentCount = nearby.length;
        nearbyCountRef.current = currentCount;
        if (currentCount === 0) return;
        const lastSeen = parseInt(
          (await AsyncStorage.getItem('@ribolov/nearbyBadgeSeen')) ?? '0',
          10,
        );
        // Only badge if more nearby catches than last time the user looked.
        // The badge then shows just the delta — e.g. "2" means two new ones.
        const delta = currentCount - lastSeen;
        if (delta > 0) setMapBadge(String(delta));
      } catch {}
    })();
  }, []);

  React.useEffect(() => {
    AsyncStorage.getItem('@ribolov/feedLastVisit')
      .then((v) => {
        if (!v || Date.now() - parseInt(v, 10) > 30 * 60 * 1000) {
          setFeedBadge('·');
        }
      })
      .catch(() => {});
  }, []);
  return (
    <Tabs.Navigator
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="HomeTab" component={HomeScreenWrapped} options={{ title: 'Начало' }} />
      <Tabs.Screen
        name="LogbookTab"
        component={LogbookNavigator}
        options={{ title: 'Дневник' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate('LogbookTab', { screen: 'LogbookList' }); },
        })}
      />
      <Tabs.Screen
        name="MapTab"
        component={MapScreenWrapped}
        options={{ title: 'Карта', tabBarBadge: mapBadge }}
        listeners={() => ({
          tabPress: () => {
            setMapBadge(undefined);
            // Persist the dismissal so we don't re-badge on next cold start
            // unless the user adds MORE nearby catches.
            AsyncStorage.setItem(
              '@ribolov/nearbyBadgeSeen',
              String(nearbyCountRef.current),
            ).catch(() => {});
          },
        })}
      />
      <Tabs.Screen
        name="FeedTab"
        component={FeedNavigator}
        options={{ title: 'Лента', tabBarBadge: feedBadge }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            setFeedBadge(undefined);
            AsyncStorage.setItem('@ribolov/feedLastVisit', String(Date.now())).catch(() => {});
            navigation.navigate('FeedTab', { screen: 'FeedList' });
          },
        })}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{ title: 'Профил', tabBarBadge: profileBadge > 0 ? profileBadge : undefined }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            // Skip the intermediate "guest profile" screen when not signed in
            // — it only ever rendered a "Вход / Регистрация" button, which is
            // exactly what Auth itself is. Route there directly instead so
            // tapping Профил from a signed-out state opens the form, not a
            // useless splash. Signed-in users continue to land on ProfileMain.
            //
            // `Auth` is NOT on the root stack — it's registered inside both
            // ProfileStack and FeedStack (see lines ~121 and ~138). From the
            // tab-level navigator we have to drill into the nested ProfileTab
            // stack to find it; a bare navigate('Auth') from this scope fails
            // with "screen not handled by any navigator".
            if (!user) {
              navigation.navigate('ProfileTab', { screen: 'Auth' });
              return;
            }
            navigation.navigate('ProfileTab', { screen: 'ProfileMain' });
          },
        })}
      />
    </Tabs.Navigator>
  );
}

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ribolov-app://'],
  config: {
    screens: {
      Main: {
        screens: {
          ProfileTab: {
            screens: {
              Notifications: 'notifications',
            },
          },
        },
      },
      UserPublicProfile: 'user/:uid',
    },
  },
};

export function RootNavigator() {
  const { colors, mode } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);

  // Onboarding gating lives in App.tsx (key: @ribolov/onboarding_done) — it
  // renders OnboardingScreen INSTEAD of the navigator on first launch.
  // We previously had a second gate here using a different AsyncStorage key
  // (@ribolov/onboardingComplete), which fired the slides AGAIN after the
  // App.tsx flag was set. Two gates with divergent keys is the kind of
  // brittleness that shows up only on real devices — removed.

  useNotificationNavigation(navigationRef, navReady);

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: mode === 'dark',
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, mode]
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      onReady={() => setNavReady(true)}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={TabNavigator} />
        <RootStack.Screen name="UserPublicProfile" component={UserPublicProfileWrapped} />
        <RootStack.Screen
          name="Search"
          getComponent={() => require('../screens/SearchScreen').default}
          options={{ presentation: 'modal' }}
        />
        <RootStack.Screen
          name="WaterDetail"
          getComponent={() => require('../screens/WaterDetailScreen').default}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

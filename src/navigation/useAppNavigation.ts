import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  RootStackParamList,
  ProfileStackParamList,
  FeedStackParamList,
  LogbookStackParamList,
  SpeciesStackParamList,
  TabsParamList,
} from './types';

type AllRouteParams =
  LogbookStackParamList &
  SpeciesStackParamList &
  ProfileStackParamList &
  FeedStackParamList &
  TabsParamList &
  RootStackParamList;

export type AppNavigationProp = NativeStackNavigationProp<AllRouteParams>;

export function useAppNavigation(): AppNavigationProp {
  return useNavigation<AppNavigationProp>();
}

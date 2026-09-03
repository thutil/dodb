cask "dodb" do
  version "0.4.4"
  sha256 "88d3a9298247e9e9f9cc4d835523698b157fe7c1f57587873b4910d5cc7622f3"

  url "https://github.com/thutil/dodb/releases/download/v#{version}/dodb_#{version}_universal.dmg"
  name "dodb"
  desc "Modern Multi-Platform Database Manager for Postgres, MySQL, MariaDB & SQLite"
  homepage "https://github.com/thutil/dodb"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app does not update itself yet, so brew must be allowed to replace it.
  # This was previously `true`, which told Homebrew to leave the app alone and
  # left `brew upgrade --cask dodb` users on an old build indefinitely. Flip it
  # back to true only once the in-app updater actually ships.
  auto_updates false
  depends_on macos: ">= :sonoma"

  app "dodb.app"

  zap trash: [
    # Where dodb really keeps its data: saved connections and the master key
    # that decrypts their passwords. Omitting it meant `brew zap` left
    # credentials on disk after the app was gone.
    "~/.dodb",
    "~/Library/Application Support/com.thutil.dodb",
    "~/Library/Caches/com.thutil.dodb",
    "~/Library/Preferences/com.thutil.dodb.plist",
    "~/Library/Saved Application State/com.thutil.dodb.savedState",
    "~/Library/WebKit/com.thutil.dodb",
  ]
end
